import http from "http";
import { stopCleanupTask } from "./server";
import { storageWorker } from "./monitor/storage/worker";
import {
  stopWatcher,
  performDirectRestart,
} from "./ops";
import { logger } from "./utils/logger";

let serverInstance: http.Server | null = null;
let isShuttingDown = false;

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
  reason: string = "SIGTERM"
): Promise<void> {
  if (isShuttingDown) {
    logger.info(`Shutdown already in progress (reason: ${reason})`);
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

    // 3. 停止 watcher
    stopWatcher();
    logger.info("Watcher stopped");

    // 4. Flush 监控队列并关闭存储
    await storageWorker.shutdown();
    logger.info("Storage worker shutdown complete");

    clearTimeout(forceExitTimer);
    logger.info("Graceful shutdown completed");
  } catch (error) {
    logger.error("Graceful shutdown failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    stopCleanupTask();
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

/**
 * 请求重启（优雅关闭后由主进程自己启动新进程）
 * 不再依赖 watcher 子进程，避免 Windows 上 detached 子进程被终止的问题。
 */
export function requestRestart(): void {
  if (isShuttingDown) {
    logger.warn("Restart requested but shutdown in progress");
    return;
  }

  logger.info("Restart requested via ops");

  void gracefulShutdown("restart").then(() => {
    performDirectRestart();
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
