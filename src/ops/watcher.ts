import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

let watcherProcess: ChildProcess | null = null;
let mainProcessPid: number = -1;

/**
 * 获取 watcher-child.js 的路径。
 * 优先使用当前模块目录，其次回退到 dist / src 目录，以兼容开发、构建产物和 Bun 打包场景。
 */
function getWatcherChildPath(): string {
  const candidates = [
    path.resolve(__dirname, "watcher-child.js"),
    path.join(process.cwd(), "dist", "ops", "watcher-child.js"),
    path.join(process.cwd(), "src", "ops", "watcher-child.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate watcher-child.js. Checked: ${candidates.join(", ")}`);
}

export function startWatcher(): void {
  if (watcherProcess) {
    logger.warn("Watcher is already running");
    return;
  }

  mainProcessPid = process.pid;

  let watcherChildPath: string;
  try {
    watcherChildPath = getWatcherChildPath();
  } catch (error) {
    logger.error("Failed to locate watcher child script", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  logger.info(`Watcher child path: ${watcherChildPath}`);

  // detached: true 确保主进程退出后 watcher 继续存活（负责启动新主进程）
  // windowsHide: true 避免在 Windows 上弹出额外控制台窗口
  watcherProcess = spawn(
    process.execPath,
    [watcherChildPath],
    {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      detached: true,
      windowsHide: true,
      env: {
        ...process.env,
        WATCHER_MAIN_PID: String(mainProcessPid),
        WATCHER_ENABLED: "true",
      },
    }
  );

  watcherProcess.unref();

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

export function stopWatcher(): void {
  if (watcherProcess) {
    watcherProcess.kill("SIGTERM");
    watcherProcess = null;
    logger.info("Watcher process stopped");
  }
}

export function isWatcherActive(): boolean {
  return watcherProcess !== null && !watcherProcess.killed && watcherProcess.connected === true;
}

export function notifyWatcherRestart(): boolean {
  const currentWatcher = watcherProcess;

  if (!currentWatcher || currentWatcher.killed || currentWatcher.connected !== true) {
    logger.warn("Watcher not running, will use direct restart");
    return false;
  }

  try {
    currentWatcher.send?.({
      type: "restart",
      pid: process.pid,
      timestamp: Date.now(),
    });
    logger.info("Restart signal sent to watcher");
    return true;
  } catch (error) {
    logger.error("Failed to send restart signal to watcher", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * 直接重启（主进程自己 spawn 新进程后退出）
 * 不依赖 watcher 子进程，避免 Windows 上 detached 子进程存活问题。
 */
export function performDirectRestart(): void {
  logger.info("Performing direct restart...");

  setTimeout(() => {
    const entryPath = path.join(process.cwd(), "dist", "index.js");
    const child = spawn(process.execPath, [entryPath], {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
      env: process.env,
      cwd: process.cwd(),
    });
    child.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error(`[restart] Failed to spawn new process: ${err.message}`);
      process.exit(1);
    });
    child.on("spawn", () => {
      child.unref();
      process.exit(0);
    });
  }, 1500);
}
