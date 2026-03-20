import http from "http";
import { stopCleanupTask } from "./server";
import { storageWorker } from "./monitor/storage/worker";
import { stopWatcher } from "./ops";
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
export async function gracefulShutdown(reason: string = "SIGTERM"): Promise<void> {
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

    // 3. 停止 watcher
    stopWatcher();
    logger.info("Watcher stopped");

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
  void gracefulShutdown("restart").then(() => {
    // 关闭完成后通知 watcher 启动新进程，然后退出
    notifyWatcherShutdown();
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
 * 通知 watcher 重启并退出
 */
function notifyWatcherShutdown(): void {
  // 动态导入避免循环依赖
  import("./ops").then(({ isWatcherActive, notifyWatcherRestart, performDirectRestart }) => {
    if (isWatcherActive()) {
      notifyWatcherRestart();
    } else {
      // 无 watcher 时直接重启
      performDirectRestart();
    }
  });
}

/**
 * 检查是否正在关闭
 */
export function isShuttingDownNow(): boolean {
  return isShuttingDown;
}
