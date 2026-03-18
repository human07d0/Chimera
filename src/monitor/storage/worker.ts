import { config } from "../../config";
import { logger } from "../../utils/logger";
import { MonitorEvent, MonitorStorage } from "./index";

interface QueueItem {
  event: MonitorEvent;
  retries: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class StorageWorker {
  private queue: QueueItem[] = [];
  private storage: MonitorStorage | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private failedCount = 0;
  private droppedCount = 0;
  private queueOverflowWarned = false;
  private readonly maxRetries = 3;

  private isShuttingDown = false;
  private isShutdown = false;
  private shutdownPromise: Promise<void> | null = null;
  private storageClosed = false;

  private readonly shutdownTimeoutMs = 8_000;

  constructor() {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, config.monitor.flushIntervalMs);
  }

  setStorage(storage: MonitorStorage): void {
    this.storage = storage;
    this.storageClosed = false;
  }

  append(event: MonitorEvent): void {
    if (this.isShuttingDown || this.isShutdown) {
      this.droppedCount++;
      logger.warn("Monitor worker is shutting down, dropping new record", {
        requestId: event.request_id,
        path: event.path,
      });
      return;
    }

    if (this.queue.length >= config.monitor.queueMaxSize) {
      this.droppedCount++;
      if (!this.queueOverflowWarned) {
        this.queueOverflowWarned = true;
        logger.warn("Monitor queue reached max size, dropping new records", {
          queueSize: this.queue.length,
          queueMaxSize: config.monitor.queueMaxSize,
        });
      }
      return;
    }

    if (
      this.queueOverflowWarned &&
      this.queue.length < config.monitor.queueMaxSize
    ) {
      this.queueOverflowWarned = false;
      logger.info("Monitor queue recovered below max size", {
        queueSize: this.queue.length,
        queueMaxSize: config.monitor.queueMaxSize,
      });
    }

    this.queue.push({ event, retries: 0 });

    if (this.queue.length >= config.monitor.flushBatchSize) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (
      this.isFlushing ||
      !this.storage ||
      this.queue.length === 0 ||
      this.isShutdown
    ) {
      return;
    }

    this.isFlushing = true;
    const batch = this.queue.splice(0, config.monitor.flushBatchSize);

    try {
      const retryItems: QueueItem[] = [];

      for (const item of batch) {
        try {
          await this.storage.append(item.event);
        } catch (error) {
          item.retries += 1;

          if (item.retries <= this.maxRetries) {
            retryItems.push(item);
            logger.warn(
              `Retry ${item.retries}/${this.maxRetries} for monitor record`,
              {
                requestId: item.event.request_id,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          } else {
            this.failedCount += 1;
            logger.error(
              `Failed to write monitor record after ${this.maxRetries} retries`,
              {
                requestId: item.event.request_id,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
      }

      if (retryItems.length > 0) {
        this.queue.push(...retryItems);
      }
    } catch (error) {
      logger.error("Error flushing monitor queue", {
        error: error instanceof Error ? error.message : String(error),
        batchSize: batch.length,
      });
    } finally {
      this.isFlushing = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    logger.info("Shutting down monitor storage worker...");
    this.isShuttingDown = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    const deadline = Date.now() + this.shutdownTimeoutMs;
    while (this.queue.length > 0 && Date.now() < deadline) {
      await this.flush();
      if (this.queue.length > 0) {
        await sleep(10);
      }
    }

    if (this.queue.length > 0) {
      this.droppedCount += this.queue.length;
      logger.warn(
        "Monitor worker shutdown timeout reached, dropping remaining records",
        {
          remainingQueueSize: this.queue.length,
        },
      );
      this.queue = [];
    }

    if (this.storage && !this.storageClosed) {
      await this.storage.close();
      this.storageClosed = true;
    }

    this.isShutdown = true;

    if (this.failedCount > 0 || this.droppedCount > 0) {
      logger.warn("Monitor worker shutdown with data loss", {
        failedWrites: this.failedCount,
        droppedRecords: this.droppedCount,
      });
    }

    logger.info("Monitor storage worker shutdown complete");
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getFailedCount(): number {
    return this.failedCount;
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }
}

export const storageWorker = new StorageWorker();
