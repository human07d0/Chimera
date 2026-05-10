import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";

import { monitorRouter, monitorMiddleware } from "./monitor";
import { opsRouter } from "./ops/index";
import { getStorage } from "./monitor/storage/factory";
import { chatRouter } from "./routes/chat";
import { anthropicRouter } from "./routes/anthropic";
import { modelsRouter } from "./routes/models";
import { config } from "./config";
import { logger } from "./utils/logger";
import { extractApiKey } from "./utils/auth";
import { debugMiddleware, debugRouter } from "./debug";
import { createTokenPlanRouter } from "./token-plan/server";

let cleanupInterval: NodeJS.Timeout | null = null;

export async function createApp(): Promise<express.Application> {
  const app = express();

  // 判断是否开发环境
  const isDev = process.env["NODE_ENV"] !== "production";

  // --------------------------------------------------------------------------
  // 基础中间件
  // --------------------------------------------------------------------------
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS, PUT, DELETE",
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, api-key, x-api-key, x-requested-with",
    );

    // 处理预检请求 (OPTIONS)
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  });

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  app.use(express.json({ limit: config.server.maxBodySize }));

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
      upstreamModels: config.upstream.enabledModels,
      defaultUpstreamModel: config.upstream.defaultModel,
      auth: config.proxyApiKey ? "enabled" : "disabled",
    });
  });

  // --------------------------------------------------------------------------
  // 监控路由（设计上不需要鉴权 — 本地可观测性端点）
  // --------------------------------------------------------------------------
  app.use("/monitor", monitorRouter);

  // --------------------------------------------------------------------------
  // 调试路由（设计上不需要鉴权，仅 DEBUG_ENABLED=true 时挂载）
  // --------------------------------------------------------------------------
  if (config.debug.enabled) {
    app.use("/debug", debugRouter);

    // 调试前端 SPA
    const debugPublicDir = resolveStaticDir("debug");
    if (debugPublicDir) {
      app.use("/debug", express.static(debugPublicDir));
      app.use("/debug", (_req: Request, res: Response) => {
        res.sendFile(path.join(debugPublicDir, "index.html"));
      });
    }
  }

  // --------------------------------------------------------------------------
  // Ops 运维界面（同进程托管）
  //
  // 开发环境：Vite 中间件模式 — 即时编译 TypeScript，HMR 热更新
  // 生产环境：预构建 dist/ops 静态文件
  // --------------------------------------------------------------------------
  if (isDev) {
    const { createViteDevMiddleware } = await import("./ops/vite-dev");
    await createViteDevMiddleware(app);
  } else {
    // 静态文件 -> API 路由 -> SPA fallback
    const opsPublicDir = resolveStaticDir("ops");

    if (opsPublicDir) {
      app.use("/ops", express.static(opsPublicDir));
      app.use("/ops", opsRouter);
      app.use("/ops", (_req: Request, res: Response) => {
        res.sendFile(path.join(opsPublicDir, "index.html"));
      });
    }
  }

  // --------------------------------------------------------------------------
  // 鉴权中间件（作用于 /v1/* 与 /anthropic/v1/* 路由）
  // --------------------------------------------------------------------------
  app.use("/v1", authMiddleware);
  app.use("/anthropic/v1", authMiddleware);

  // --------------------------------------------------------------------------
  // API 路由（添加监控中间件，可选调试中间件）
  // --------------------------------------------------------------------------
  if (config.debug.enabled) {
    app.use("/v1", debugMiddleware);
    app.use("/anthropic/v1", debugMiddleware);
  }
  app.use("/v1", monitorMiddleware);
  app.use("/anthropic/v1", monitorMiddleware);
  app.use("/v1", modelsRouter);
  app.use("/v1", chatRouter);
  app.use("/anthropic/v1", anthropicRouter);

  // --------------------------------------------------------------------------
  // Token-Plan 透传代理（条件挂载）
  // --------------------------------------------------------------------------
  if (config.tokenPlan.enabled) {
    const tokenPlanRouter = createTokenPlanRouter();

    // token-plan 需要额外的 CORS 头（anthropic-version、anthropic-beta）
    app.use("/token-plan", (_req: Request, res: Response, next: NextFunction) => {
      res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, api-key, x-api-key, x-requested-with, anthropic-version, anthropic-beta"
      );
      next();
    });

    // debug 中间件覆盖 token-plan 路由
    if (config.debug.enabled) {
      app.use("/token-plan/v1", debugMiddleware);
      app.use("/token-plan/anthropic/v1", debugMiddleware);
    }

    // 标记 token-plan 来源并挂载监控中间件
    app.use("/token-plan/v1", (_req: Request, res: Response, next: NextFunction) => {
      res.locals.source = "token-plan";
      next();
    });
    app.use("/token-plan/v1", monitorMiddleware);
    app.use("/token-plan/anthropic/v1", (_req: Request, res: Response, next: NextFunction) => {
      res.locals.source = "token-plan";
      next();
    });
    app.use("/token-plan/anthropic/v1", monitorMiddleware);

    app.use("/token-plan", tokenPlanRouter);
    logger.info("Token-plan router mounted at /token-plan");
  }

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
  const cleanup = () => {
    try {
      const storage = getStorage();
      const retentionDays = config.monitor.retentionDays;
      const startTime = Date.now();
      const deletedCount = storage.prune(retentionDays);

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
    // Production: dist/ops (for Vite build output)
    path.join(__dirname, dirName),
    // Development: src/ops/frontend (Vite root for dev server)
    path.join(__dirname, dirName, "frontend"),
    path.join(process.cwd(), "src", dirName, "frontend"),
    // Fallback: process.cwd()
    path.join(process.cwd(), dirName),
  ];

  for (const candidate of candidates) {
    // Check for index.html existence (not just directory)
    const indexPath = path.join(candidate, "index.html");
    if (fs.existsSync(indexPath)) {
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
          "Missing API key. Provide it via 'Authorization: Bearer <key>', 'api-key: <key>' or 'x-api-key: <key>' header.",
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

