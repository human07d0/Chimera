import { getStorage } from "./storage/factory";
import { config } from "../config";
import { logger } from "../utils/logger";

let cleanupInterval: NodeJS.Timeout | null = null;

export function startCleanupTask(): void {
  const cleanup = () => {
    try {
      const storage = getStorage();
      const retentionDays = config.monitor.retentionDays;
      const startTime = Date.now();
      const deletedCount = storage.prune(retentionDays);

      logger.info("Daily cleanup completed", {
        retentionDays,
        deletedCount,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      logger.error("Daily cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  void cleanup();

  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  const oneDayMs = 24 * 60 * 60 * 1000;
  cleanupInterval = setInterval(() => {
    void cleanup();
  }, oneDayMs);

  logger.info(`Daily cleanup task scheduled (every ${oneDayMs}ms)`);
}

export function stopCleanupTask(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info("Daily cleanup task stopped");
  }
}
