import { Request, Response, Router } from "express";
import { opsAuthMiddleware } from "./middleware";
import { OpsConfigManager } from "./configManager";
import { isWatcherActive } from "./watcher";
import { requestShutdown, requestRestart } from "../shutdownManager";
import { logger } from "../utils/logger";
import { config } from "../config";
import { generateSchema } from "./configSchema";
import { modelRegistry } from "../providers/registry";

export const opsRouter: Router = Router();

// 获取服务基本信息（公开，无需鉴权）- 必须在鉴权中间件之前定义
opsRouter.get("/info", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      enabled: !!config.opsPassword,
      version: process.env.npm_package_version || "unknown",
    },
  });
});

opsRouter.get("/config", opsAuthMiddleware, (_req: Request, res: Response) => {
  const currentConfig = OpsConfigManager.getCurrentConfig();

  res.json({
    success: true,
    data: currentConfig,
  });
});

opsRouter.post("/config", opsAuthMiddleware, (req: Request, res: Response) => {
  const updates = req.body as Record<string, unknown>;

  if (!updates || typeof updates !== "object" || Object.keys(updates).length === 0) {
    res.status(400).json({
      success: false,
      error: "Request body must be a non-empty object with configuration updates",
    });
    return;
  }

  const result = OpsConfigManager.updateConfig(updates);

  if (!result.success) {
    res.status(400).json({
      success: false,
      error: result.error,
    });
    return;
  }

  res.json({
    success: true,
    message: "Configuration updated successfully",
    data: OpsConfigManager.getCurrentConfig(),
  });
});

opsRouter.get("/config/schema", opsAuthMiddleware, (_req: Request, res: Response) => {
  const schema = generateSchema();

  res.json({
    success: true,
    data: schema,
  });
});

opsRouter.get("/status", opsAuthMiddleware, (_req: Request, res: Response) => {
  const providers = modelRegistry.getProviders();
  const endpoints = modelRegistry.getEndpoints();

  const providerInfo = providers.map(p => {
    const providerModels = endpoints.flatMap(ep =>
      modelRegistry.getAllModels(ep).filter(m => m.providerName === p.name)
    );
    return {
      name: p.name,
      type: p.type,
      endpoint: p.endpoint || "(default)",
      modelCount: providerModels.length,
    };
  });

  res.json({
    success: true,
    data: {
      uptime: process.uptime(),
      pid: process.pid,
      memory: process.memoryUsage(),
      watcherActive: isWatcherActive(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      providers: providerInfo,
    },
  });
});

opsRouter.post("/shutdown", opsAuthMiddleware, (req: Request, res: Response) => {
  logger.info("Ops shutdown requested", {
    ip: req.ip,
  });

  res.json({
    success: true,
    message: "Shutdown initiated",
  });

  // 延迟执行，确保响应已发送
  setTimeout(() => {
    requestShutdown();
  }, 100);
});

opsRouter.post("/restart", opsAuthMiddleware, (req: Request, res: Response) => {
  logger.info("Ops restart requested", {
    ip: req.ip,
    watcherActive: isWatcherActive(),
  });

  res.json({
    success: true,
    message: "Restart initiated",
    hint: "The service will restart. If watcher is not active, it may briefly disconnect.",
  });

  // 延迟执行，确保响应已发送
  setTimeout(() => {
    requestRestart();
  }, 100);
});
