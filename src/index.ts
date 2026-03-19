import { config } from "./config";
import { VIRTUAL_MODELS } from "./models/presets";
import { getStorage } from "./monitor/storage/factory";
import { storageWorker } from "./monitor/storage/worker";
import { createApp, stopCleanupTask } from "./server";
import { logger } from "./utils/logger";

// 启动前校验
function validateConfig(): void {
  if (!config.proxyApiKey) {
    logger.warn(
      "PROXY_API_KEY is not set — the proxy is running WITHOUT authentication. " +
        "Anyone with network access can use your MiMo API key. " +
        "Set PROXY_API_KEY in .env for production use."
    );
  }
}

function printStartupInfo(): void {
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info("  MiMo Proxy starting up");
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info(`  Upstream : ${config.upstream.baseUrl}`);
  logger.info(`  Enabled upstream models: ${config.upstream.enabledModels.join(", ")}`);
  logger.info(`  Default upstream model: ${config.upstream.defaultModel}`);
  logger.info(`  Auth     : ${config.proxyApiKey ? "enabled" : "DISABLED (no PROXY_API_KEY)"}`);
  logger.info(`  Log level: ${config.logLevel}`);
  logger.info(
    `  Monitor  : storage=${config.monitor.storage}, retention=${config.monitor.retentionDays}d, flushInterval=${config.monitor.flushIntervalMs}ms, flushBatch=${config.monitor.flushBatchSize}, queueMax=${config.monitor.queueMaxSize}`
  );
  logger.info("");
  logger.info("  Available virtual models:");
  for (const m of VIRTUAL_MODELS) {
    const flags = [
      m.features.thinking ? "thinking" : null,
      m.features.search ? "search" : null,
      m.features.json ? "json" : null,
    ]
      .filter(Boolean)
      .join(", ");
    logger.info(`    ${m.id.padEnd(42)} -> ${m.upstreamModel.padEnd(12)} [${flags || "base"}]`);
  }
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

async function main(): Promise<void> {
  validateConfig();

  // 先初始化存储，确保数据库连接准备好
  await getStorage();

  const app = createApp();
  const server = app.listen(config.server.port, config.server.host, () => {
    printStartupInfo();
    logger.info(`  Listening on http://${config.server.host}:${config.server.port}`);
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });

  let isShuttingDown = false;

  // 优雅关闭
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      logger.info(`Received ${signal} during shutdown, ignoring duplicate signal`);
      return;
    }

    isShuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);

    const forceExitTimer = setTimeout(() => {
      logger.error("Forced exit after timeout");
      process.exit(1);
    }, 10_000);

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err?: Error) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });

      logger.info("Server closed.");
      stopCleanupTask();
      await storageWorker.shutdown();

      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (error) {
      logger.error("Graceful shutdown failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      stopCleanupTask();
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});



