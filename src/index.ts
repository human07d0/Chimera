import { config } from "./config";
import { VIRTUAL_MODELS } from "./models/presets";
import { getStorage } from "./monitor/storage/factory";
import { createApp } from "./server";
import { startWatcher } from "./ops";
import { gracefulShutdown, setServer } from "./shutdownManager";
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

  // 初始化存储（better-sqlite3 使用同步 API）
  getStorage();

  // Ops 运维界面已启用时启动 watcher
  if (config.opsPassword) {
    startWatcher();
  }

  const app = createApp();
  const server = app.listen(config.server.port, config.server.host, () => {
    printStartupInfo();
    logger.info(`  Listening on http://${config.server.host}:${config.server.port}`);
    if (config.opsPassword) {
      logger.info(`  Ops interface: enabled (auth required)`);
    } else {
      logger.info(`  Ops interface: DISABLED (no OPS_PASSWORD)`);
    }
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });

  // 注册服务器实例供 shutdownManager 使用
  setServer(server);

  // 注册信号处理
  process.on("SIGTERM", () => {
    void gracefulShutdown("SIGTERM");
  });

  process.on("SIGINT", () => {
    void gracefulShutdown("SIGINT");
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
