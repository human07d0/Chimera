import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { monitorRouter, monitorMiddleware } from "./monitor";
import { getStorage } from "./monitor/storage/factory";
import { chatRouter } from "./routes/chat";
import { modelsRouter } from "./routes/models";
import { config } from "./config";
import { logger } from "./utils/logger";

let cleanupInterval: NodeJS.Timeout | null = null;

export function createApp(): express.Application {
  const app = express();

  // --------------------------------------------------------------------------
  // 基础中间件
  // --------------------------------------------------------------------------
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, api-key, x-requested-with"
    );

    // 处理预检请求 (OPTIONS)
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  });

  app.use(express.json({ limit: "10mb" }));

  // --------------------------------------------------------------------------
  // 静态文件服务 (PWA)
  // --------------------------------------------------------------------------
  const publicDir = resolveStaticDir("public");
  if (publicDir) {
    app.use(express.static(publicDir));
  }

  // --------------------------------------------------------------------------
  // 请求日志（仅记录元信息，不记录 body）
  // --------------------------------------------------------------------------
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug("Incoming HTTP request", {
      method: req.method,
      path: req.path,
      ip: req.ip,
      contentLength: req.headers["content-length"],
    });
    next();
  });

  // --------------------------------------------------------------------------
  // 健康检查（不需要鉴权）
  // --------------------------------------------------------------------------
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      upstreamModel: config.upstream.model,
      auth: config.proxyApiKey ? "enabled" : "disabled",
    });
  });

  // --------------------------------------------------------------------------
  // 监控路由（不需要鉴权）
  // --------------------------------------------------------------------------
  app.use("/monitor", monitorRouter);

  // --------------------------------------------------------------------------
  // 鉴权中间件（作用于 /v1/* 路由）
  // --------------------------------------------------------------------------
  app.use("/v1", authMiddleware);

  // --------------------------------------------------------------------------
  // API 路由（添加监控中间件）
  // --------------------------------------------------------------------------
  app.use("/v1", monitorMiddleware);
  app.use("/v1", modelsRouter);
  app.use("/v1", chatRouter);

  // --------------------------------------------------------------------------
  // 404 处理
  // --------------------------------------------------------------------------
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        message: "The requested endpoint does not exist",
        type: "invalid_request_error",
        code: "endpoint_not_found",
      },
    });
  });

  // --------------------------------------------------------------------------
  // 全局错误处理
  // --------------------------------------------------------------------------
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("Unhandled error", {
      name: err.name,
      message: err.message,
      stack: config.logLevel === "debug" ? err.stack : undefined,
    });
    res.status(500).json({
      error: {
        message: "Internal proxy error",
        type: "internal_error",
        code: "internal_error",
      },
    });
  });

  // --------------------------------------------------------------------------
  // 启动定时清理任务（启动时执行一次，之后每 24h 一次）
  // --------------------------------------------------------------------------
  startCleanupTask();

  return app;
}

function startCleanupTask(): void {
  const cleanup = async () => {
    try {
      const storage = await getStorage();
      const retentionDays = config.monitor.retentionDays;
      const startTime = Date.now();
      const deletedCount = await storage.prune(retentionDays);

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

  // 立即执行一次（启动时）
  void cleanup();

  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  // 每天执行一次
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

function resolveStaticDir(dirName: string): string | null {
  const candidates = [
    path.join(__dirname, dirName),
    path.join(process.cwd(), dirName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  logger.warn(`Static directory not found: ${dirName}`);
  return null;
}

// --------------------------------------------------------------------------
// 鉴权逻辑
// --------------------------------------------------------------------------
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 未配置 PROXY_API_KEY 时跳过鉴权
  if (!config.proxyApiKey) {
    next();
    return;
  }

  const providedKey = extractApiKey(req);

  if (!providedKey) {
    res.status(401).json({
      error: {
        message:
          "Missing API key. Provide it via 'Authorization: Bearer <key>' or 'api-key: <key>' header.",
        type: "authentication_error",
        code: "missing_api_key",
      },
    });
    return;
  }

  if (providedKey !== config.proxyApiKey) {
    res.status(401).json({
      error: {
        message: "Invalid API key.",
        type: "authentication_error",
        code: "invalid_api_key",
      },
    });
    return;
  }

  next();
}

/** 从请求头中提取 API Key，支持两种方式 */
function extractApiKey(req: Request): string | null {
  // 方式一：Authorization: Bearer <key>
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  // 方式二：api-key: <key>
  const apiKeyHeader = req.headers["api-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }

  return null;
}


