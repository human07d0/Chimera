import http from "http";
import { stopCleanupTask } from "./server";
import { storageWorker } from "./monitor/storage/worker";
import {
  isWatcherActive,
  notifyWatcherRestart,
  performDirectRestart,
  stopWatcher,
} from "./ops";
import { logger } from "./utils/logger";

let serverInstance: http.Server | null = null;
let isShuttingDown = false;
let shutdownResolve: (() => void) | null = null;

/**
 * 设置服务器实例，供 shutdown 管理器使用
 */
export function setServer(server: http.Server): void {
  serverInstance = server;
}

/**
 * 执行优雅关闭（等待监控队列 flush 完成）
 * @param reason 关闭原因（用于日志）
 */
export async function gracefulShutdown(
  reason: string = "SIGTERM",
  options: { preserveWatcher?: boolean } = {}
): Promise<void> {
  if (isShuttingDown) {
    logger.info(`Shutdown already in progress (reason: ${reason})`);
    if (shutdownResolve) {
      await new Promise<void>((resolve) => {
        shutdownResolve = resolve;
      });
    }
    return;
  }

  isShuttingDown = true;
  logger.info(`Shutting down gracefully (reason: ${reason})...`);

  const forceExitTimer = setTimeout(() => {
    logger.error("Forced exit after timeout");
    process.exit(1);
  }, 10_000);

  try {
    // 1. 关闭 HTTP 服务器（停止接收新请求）
    if (serverInstance) {
      await new Promise<void>((resolve, reject) => {
        serverInstance!.close((err?: Error) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
      logger.info("HTTP server closed");
    }

    // 2. 停止定时任务
    stopCleanupTask();
    logger.info("Cleanup tasks stopped");

    // 3. 停止 watcher（重启场景需要保留 watcher 接管旧进程）
    if (options.preserveWatcher) {
      logger.info("Watcher preserved for restart");
    } else {
      stopWatcher();
      logger.info("Watcher stopped");
    }

    // 4. Flush 监控队列并关闭存储
    await storageWorker.shutdown();
    logger.info("Storage worker shutdown complete");

    clearTimeout(forceExitTimer);
    logger.info("Graceful shutdown completed");

    if (shutdownResolve) {
      shutdownResolve();
      shutdownResolve = null;
    }
  } catch (error) {
    logger.error("Graceful shutdown failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    stopCleanupTask();
    clearTimeout(forceExitTimer);
    if (shutdownResolve) {
      shutdownResolve();
      shutdownResolve = null;
    }
    process.exit(1);
  }
}

/**
 * 请求重启（优雅关闭后通知 watcher 启动新进程）
 */
export function requestRestart(): void {
  if (isShuttingDown) {
    logger.warn("Restart requested but shutdown in progress");
    return;
  }

  logger.info("Restart requested via ops");

  const watcherActive = isWatcherActive();

  if (!watcherActive) {
    void gracefulShutdown("restart", { preserveWatcher: false }).then(() => {
      performDirectRestart();
    });
    return;
  }

  // 先通知 watcher 准备接管，再开始关闭流程，避免 watcher 被提前停掉
  const notified = notifyWatcherRestart();

  if (!notified) {
    logger.warn("Watcher notification failed, falling back to direct restart");
    void gracefulShutdown("restart", { preserveWatcher: false }).then(() => {
      performDirectRestart();
    });
    return;
  }

  void gracefulShutdown("restart", { preserveWatcher: true }).then(() => {
    process.exit(0);
  });
}

/**
 * 请求关闭
 */
export function requestShutdown(): void {
  if (isShuttingDown) {
    logger.warn("Shutdown requested but shutdown in progress");
    return;
  }

  logger.info("Shutdown requested via ops");
  void gracefulShutdown("ops").then(() => {
    process.exit(0);
  });
}

/**
 * 检查是否正在关闭
 */
export function isShuttingDownNow(): boolean {
  return isShuttingDown;
}
