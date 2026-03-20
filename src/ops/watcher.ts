import { spawn, ChildProcess } from "child_process";
import path from "path";
import { logger } from "../utils/logger";

let watcherProcess: ChildProcess | null = null;
let mainProcessPid: number = -1;

/**
 * 启动 watcher 进程
 * watcher 监控主进程 PID，收到重启信号后重新启动主进程
 */
export function startWatcher(): void {
  if (watcherProcess) {
    logger.warn("Watcher is already running");
    return;
  }

  mainProcessPid = process.pid;

  // 启动 watcher 子进程
  watcherProcess = spawn(
    process.execPath,
    [path.join(__dirname, "watcher-child.js")],
    {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      detached: false,
      env: {
        ...process.env,
        WATCHER_MAIN_PID: String(mainProcessPid),
        WATCHER_ENABLED: "true",
      },
    }
  );

  watcherProcess.on("message", (message: unknown) => {
    if (typeof message === "object" && message !== null && "type" in message) {
      const msg = message as { type: string; pid?: number };
      if (msg.type === "ready") {
        logger.info("Watcher process started", { pid: msg.pid || watcherProcess?.pid });
      }
    }
  });

  watcherProcess.on("error", (error) => {
    logger.error("Watcher process error", { error: error.message });
    watcherProcess = null;
  });

  watcherProcess.on("exit", (code, signal) => {
    logger.info("Watcher process exited", { code, signal });
    watcherProcess = null;
  });

  // 转发 watcher 的 stdout/stderr
  if (watcherProcess.stdout) {
    watcherProcess.stdout.on("data", (data: Buffer) => {
      process.stdout.write(`[watcher] ${data.toString()}`);
    });
  }

  if (watcherProcess.stderr) {
    watcherProcess.stderr.on("data", (data: Buffer) => {
      process.stderr.write(`[watcher] ${data.toString()}`);
    });
  }

  logger.info("Starting watcher process", { mainPid: mainProcessPid });
}

/**
 * 停止 watcher 进程
 */
export function stopWatcher(): void {
  if (watcherProcess) {
    watcherProcess.kill("SIGTERM");
    watcherProcess = null;
    logger.info("Watcher process stopped");
  }
}

/**
 * 检查 watcher 是否运行中
 */
export function isWatcherActive(): boolean {
  return watcherProcess !== null && !watcherProcess.killed;
}

/**
 * 通知 watcher 重启主进程
 */
export function notifyWatcherRestart(): void {
  if (watcherProcess) {
    watcherProcess.send?.({
      type: "restart",
      pid: process.pid,
      timestamp: Date.now(),
    });
    logger.info("Restart signal sent to watcher");
  } else {
    logger.warn("Watcher not running, will use direct restart");
    performDirectRestart();
  }
}

/**
 * 直接重启（无 watcher 时的 fallback）
 */
export function performDirectRestart(): void {
  logger.info("Performing direct restart...");

  setTimeout(() => {
    const child = spawn("pnpm", ["start"], {
      stdio: "inherit",
      detached: true,
      env: process.env,
      cwd: process.cwd(),
    });
    child.unref();
    process.exit(0);
  }, 500);
}
