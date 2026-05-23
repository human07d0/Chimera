import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import { monitorRouter, monitorMiddleware } from "./monitor";
import { opsRouter } from "./ops/index";
import { getStorageAsync } from "./monitor/storage/factory";
import { chatRouter } from "./routes/chat";
import { anthropicRouter } from "./routes/anthropic";
import { modelsRouter } from "./routes/models";
import { endpointsRouter } from "./routes/endpoints";
import { apiRouter } from "./routes/api";
import { modelRegistry } from "./providers/registry";
import { registerProviderPricing } from "./monitor/pricing";
import { config } from "./config";
import { logger } from "./utils/logger";
import { authMiddleware } from "./routes/auth";
import { debugMiddleware, debugRouter, agentRouter } from "./debug";
import { localhostGuard } from "./utils/localhostGuard";
import { isLocalRequest } from "./utils/isLocalRequest";
import { startCleanupTask } from "./monitor/cleanup";
let cachedPlaygroundHtml: string | null = null;

export async function createApp(): Promise<express.Application> {
  await modelRegistry.init(config.configDir);
  registerProviderPricing(modelRegistry.getProviders());

  const app = express();
  const playgroundToken = crypto.randomUUID();

  const isDev = config.nodeEnv !== "production";

  // --------------------------------------------------------------------------
  // 基础中间件
  // --------------------------------------------------------------------------
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const p = _req.path.toLowerCase();
    if (p === "/debug" || p.startsWith("/debug/") || p === "/monitor" || p.startsWith("/monitor/")) {
      next();
      return;
    }
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS, PUT, DELETE",
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, api-key, x-api-key, x-requested-with, x-playground-token, anthropic-version, anthropic-beta",
    );

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

  app.use(express.json({ limit: config.bodySizeLimit() }));

  // --------------------------------------------------------------------------
  // 静态文件服务 (PWA)
  // --------------------------------------------------------------------------
  const publicDir = resolveStaticDir("public");
  if (publicDir) {
    app.get("/", (_req: Request, res: Response) => {
      const indexPath = path.join(publicDir, "index.html");
      let html = fs.readFileSync(indexPath, "utf-8");
      const debugAccessible = config.debug.enabled && isLocalRequest(_req);
      if (!debugAccessible) {
        html = html.replace(
          '<a class="nav-link" href="./debug/">Debug</a>',
          '<a class="nav-link" href="./debug/" hidden>Debug</a>'
        );
      }
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    });
    app.use(express.static(publicDir));
  }

  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug("Incoming HTTP request", {
      method: req.method,
      path: req.path,
      ip: req.ip,
      contentLength: req.headers["content-length"],
    });
    next();
  });

  app.get("/health", (_req: Request, res: Response) => {
    const providers = modelRegistry.getProviders();
    const totalModels = providers.reduce((sum, p) => sum + p.models.length, 0);
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      providers: providers.map((p) => p.name),
      totalModels,
    });
  });

  // --------------------------------------------------------------------------
  // API 端点目录（无需鉴权 — 供 agent/人发现可用 API）
  // --------------------------------------------------------------------------
  app.use(apiRouter);

  // --------------------------------------------------------------------------
  // 监控路由（设计上不需要鉴权 — 本地可观测性端点）
  // --------------------------------------------------------------------------
  // 确保 monitor 存储在接收请求前完成初始化
  await getStorageAsync();
  app.use("/monitor", monitorRouter);

  // --------------------------------------------------------------------------
  // 调试路由（仅允许本地环回地址访问，通过 localhostGuard 中间件控制）
  // --------------------------------------------------------------------------
  if (config.debug.enabled) {
    app.use("/debug", localhostGuard, debugRouter);
    app.use("/debug/agent", localhostGuard, agentRouter);

    const debugPublicDir = resolveStaticDir("debug");
    if (debugPublicDir) {
      app.use("/debug", localhostGuard, express.static(debugPublicDir));
      app.use("/debug", localhostGuard, (_req: Request, res: Response) => {
        res.sendFile(path.join(debugPublicDir, "index.html"));
      });
    }
  }

  // --------------------------------------------------------------------------
  // Playground（独立页面，服务端注入配置）
  // --------------------------------------------------------------------------
  const playgroundDir = resolveStaticDir("playground");
  if (playgroundDir) {
    app.get("/playground", (_req: Request, res: Response) => {
      if (!cachedPlaygroundHtml) {
        const indexPath = path.join(playgroundDir, "index.html");
        cachedPlaygroundHtml = fs.readFileSync(indexPath, "utf-8");
      }

      const playgroundConfig = buildPlaygroundConfig({
        getEndpoints: () => modelRegistry.getEndpoints(),
        getAllModels: (ep) => modelRegistry.getAllModels(ep),
        playgroundToken,
      });
      playgroundConfig.debugAccessible = config.debug.enabled && isLocalRequest(_req);
      const configScript = `<script>window.PLAYGROUND_CONFIG = ${JSON.stringify(playgroundConfig)}</script>`;
      const html = cachedPlaygroundHtml.replace("<head>", `<head>\n    ${configScript}`);

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    });
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
  // Playground proxy routes（绕过主鉴权，使用独立 token 验证）
  // --------------------------------------------------------------------------
  app.use("/playground/api", (_req: Request, res: Response, next: NextFunction) => {
    if (_req.headers["x-playground-token"] !== playgroundToken) {
      res.status(403).json({ error: "Invalid playground token" });
      return;
    }
    next();
  });

  for (const endpoint of modelRegistry.getEndpoints()) {
    const prefix = endpoint || "";
    app.use(`/playground/api${prefix}/v1`, monitorMiddleware, modelsRouter, chatRouter);
    app.use(`/playground/api${prefix}/anthropic/v1`, monitorMiddleware, anthropicRouter);
  }

  // --------------------------------------------------------------------------
  // 挂载路由（根据 registry 中的 endpoint 动态挂载）
  // --------------------------------------------------------------------------
  const endpoints = modelRegistry.getEndpoints();

  for (const endpoint of endpoints) {
    const prefix = endpoint || "";

    app.use(`${prefix}/v1`, modelsRouter);

    app.use(`${prefix}/v1`, authMiddleware);
    app.use(`${prefix}/anthropic/v1`, authMiddleware);

    app.use(`${prefix}/v1`, endpointsRouter);

    if (config.debug.enabled) {
      app.use(`${prefix}/v1`, debugMiddleware);
      app.use(`${prefix}/anthropic/v1`, debugMiddleware);
    }

    app.use(`${prefix}/v1`, monitorMiddleware);
    app.use(`${prefix}/anthropic/v1`, monitorMiddleware);

    app.use(`${prefix}/v1`, chatRouter);
    app.use(`${prefix}/anthropic/v1`, anthropicRouter);

    logger.info(`Routes mounted at ${prefix}/v1 and ${prefix}/anthropic/v1`);
  }

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        message: "The requested endpoint does not exist",
        type: "invalid_request_error",
        code: "endpoint_not_found",
      },
    });
  });

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

export function buildPlaygroundConfig(options: {
  getEndpoints: () => string[];
  getAllModels: (endpoint: string) => Array<{ model: { id: string } }>;
  playgroundToken: string;
}): {
  endpoints: string[];
  endpointModels: Record<string, string[]>;
  playgroundToken: string;
  featureSuffixes: { thinking: string; search: string; json: string };
  debugAccessible: boolean;
} {
  const endpointModels: Record<string, string[]> = {};
  for (const endpoint of options.getEndpoints()) {
    endpointModels[endpoint] = options.getAllModels(endpoint).map((m) => m.model.id);
  }
  return {
    endpoints: options.getEndpoints(),
    endpointModels,
    playgroundToken: options.playgroundToken,
    featureSuffixes: { thinking: "-thinking", search: "-search", json: "-json" },
    debugAccessible: false,
  };
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
    const indexPath = path.join(candidate, "index.html");
    if (fs.existsSync(indexPath)) {
      return candidate;
    }
  }

  logger.warn(`Static directory not found: ${dirName}`);
  return null;
}


