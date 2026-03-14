import { config } from "./config";
import { createApp } from "./server";
import { logger } from "./utils/logger";
import { VIRTUAL_MODELS } from "./models/presets";

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
  logger.info(`  Model    : ${config.upstream.model}`);
  logger.info(`  Auth     : ${config.proxyApiKey ? "enabled" : "DISABLED (no PROXY_API_KEY)"}`);
  logger.info(`  Log level: ${config.logLevel}`);
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
    logger.info(`    ${m.id.padEnd(42)} [${flags || "base"}]`);
  }
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

async function main(): Promise<void> {
  validateConfig();

  const app = createApp();

  const server = app.listen(config.server.port, config.server.host, () => {
    printStartupInfo();
    logger.info(
      `  Listening on http://${config.server.host}:${config.server.port}`
    );
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });

  // 优雅关闭
  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      logger.info("Server closed.");
      process.exit(0);
    });
    // 强制退出超时
    setTimeout(() => {
      logger.error("Forced exit after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
