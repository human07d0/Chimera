import express, { Request, Response, NextFunction } from "express";
import { config } from "./config";
import { logger } from "./utils/logger";
import { chatRouter } from "./routes/chat";
import { modelsRouter } from "./routes/models";
// 新增监控模块导入
import { monitorRouter, monitorMiddleware } from "./monitor";

export function createApp(): express.Application {
  const app = express();

  // --------------------------------------------------------------------------
  // 基础中间件
  // --------------------------------------------------------------------------
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS, PUT, DELETE"
    );
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

  return app;
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

