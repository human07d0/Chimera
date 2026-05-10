/**
 * Watcher 子进程脚本
 * 监控主进程，收到重启信号后启动新的主进程
 */
const { spawn } = require("child_process");
const process = require("process");

const MAIN_PID = parseInt(process.env.WATCHER_MAIN_PID || "0", 10);
const POLL_INTERVAL = 2000; // 每 2 秒检查一次主进程是否存活

let pendingRestart = false;
let newMainProcess = null;

console.log(`[watcher] Started, monitoring main process PID: ${MAIN_PID}`);

// 通知父进程准备就绪
process.send?.({
  type: "ready",
  pid: process.pid,
});

/**
 * 检查进程是否存活
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动新的主进程
 */
function startNewMainProcess() {
  if (newMainProcess) {
    console.log("[watcher] New main process already running");
    return;
  }

  console.log("[watcher] Starting new main process...");

  newMainProcess = spawn("pnpm", ["start"], {
    stdio: "inherit",
    detached: false,
    env: process.env,
    cwd: process.cwd(),
  });

  newMainProcess.on("error", (err) => {
    console.error(`[watcher] Failed to start main process: ${err.message}`);
    newMainProcess = null;
  });

  newMainProcess.on("exit", (code, signal) => {
    console.log(`[watcher] New main process exited: code=${code}, signal=${signal}`);
    newMainProcess = null;
  });
}

/**
 * 轮询检查主进程状态
 */
function pollMainProcess() {
  // 如果有新的主进程在运行，且旧的主进程已退出，则 watcher 任务完成
  if (newMainProcess && !isProcessAlive(MAIN_PID)) {
    console.log("[watcher] Old main process exited, new one is running");
    // watcher 可以继续运行以监控新的主进程，或者退出
    // 这里选择退出，让新的主进程自己启动新的 watcher（如果需要）
    process.exit(0);
    return;
  }

  // 如果主进程不存活，且尚未启动新进程
  if (!isProcessAlive(MAIN_PID)) {
    if (pendingRestart) {
      console.log("[watcher] Main process not alive, starting new process");
      startNewMainProcess();
      pendingRestart = false;
    } else {
      // 主进程意外退出，尝试重启
      console.log("[watcher] Main process unexpectedly exited, auto-restarting...");
      startNewMainProcess();
    }
  }
}

// 处理来自主进程的消息
process.on("message", (message) => {
  if (message && typeof message === "object") {
    if (message.type === "restart") {
      console.log(`[watcher] Received restart signal for PID: ${message.pid}`);
      pendingRestart = true;

      // 启动轮询直到主进程自行退出
      // 注意：不再主动发送 SIGTERM，避免与主进程自己的 gracefulShutdown 竞争
      // 主进程收到重启请求后会自行调用 gracefulShutdown → process.exit(0)
      const pollTimer = setInterval(() => {
        if (!isProcessAlive(MAIN_PID)) {
          clearInterval(pollTimer);
          clearTimeout(forceKillTimer);
          console.log("[watcher] Main process exited, starting new one");
          startNewMainProcess();
        }
      }, 500);

      // 15 秒超时保护：如果主进程卡住未能自行退出，则强制发送 SIGTERM
      const forceKillTimer = setTimeout(() => {
        clearInterval(pollTimer);
        if (isProcessAlive(MAIN_PID)) {
          console.log(`[watcher] Main process ${MAIN_PID} did not exit in time, sending SIGTERM`);
          try {
            process.kill(MAIN_PID, "SIGTERM");
          } catch (err) {
            console.error(`[watcher] Failed to signal main process: ${err.message}`);
          }
          // 再轮询等待退出
          const fallbackPoll = setInterval(() => {
            if (!isProcessAlive(MAIN_PID)) {
              clearInterval(fallbackPoll);
              console.log("[watcher] Main process exited after SIGTERM, starting new one");
              startNewMainProcess();
            }
          }, 500);
        }
      }, 15000);
    }
  }
});

// 主循环
setInterval(pollMainProcess, POLL_INTERVAL);

// 处理退出信号
process.on("SIGTERM", () => {
  console.log("[watcher] Received SIGTERM, exiting");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[watcher] Received SIGINT, exiting");
  process.exit(0);
});
