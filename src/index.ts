import http from "http";

import { config } from "./config";
import { createApp, stopCleanupTask } from "./server";
import {
  gracefulShutdown,
  isShuttingDownNow,
  requestRestart,
  requestShutdown,
  setServer,
} from "./shutdownManager";
import { logger } from "./utils/logger";
import { startWatcher } from "./ops";

export {
  config,
  createApp,
  stopCleanupTask,
  gracefulShutdown,
  isShuttingDownNow,
  requestRestart,
  requestShutdown,
  setServer,
};

let signalsRegistered = false;

export function startServer(): http.Server {
  const app = createApp();
  const server = http.createServer(app);

  setServer(server);
  registerSignalHandlers();

  server.on("error", (error: unknown) => {
    logger.error("Failed to start server", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });

  server.listen(config.server.port, config.server.host, () => {
    logger.info("Server started", {
      host: config.server.host,
      port: config.server.port,
    });

    // Ops 运维界面已启用时启动 watcher
    if (config.opsPassword) {
      startWatcher();
    }
  });

  return server;
}

function registerSignalHandlers(): void {
  if (signalsRegistered) {
    return;
  }

  signalsRegistered = true;

  const handleShutdownSignal = (signal: NodeJS.Signals): void => {
    if (isShuttingDownNow()) {
      logger.info(`Received ${signal} while shutdown is already in progress, ignoring...`);
      return;
    }

    logger.info(`Received ${signal}, shutting down gracefully...`);
    void gracefulShutdown(signal).then(() => {
      process.exit(0);
    });
  };

  process.once("SIGINT", () => handleShutdownSignal("SIGINT"));
  process.once("SIGTERM", () => handleShutdownSignal("SIGTERM"));
}

if (require.main === module) {
  startServer();
}