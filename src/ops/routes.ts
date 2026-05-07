import { Request, Response, Router } from "express";
import { opsAuthMiddleware } from "./middleware";
import { OpsConfigManager } from "./configManager";
import { isWatcherActive } from "./watcher";
import { requestShutdown, requestRestart } from "../shutdownManager";
import { logger } from "../utils/logger";
import { config } from "../config";

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

// Ops 路由组统一鉴权（此后的路由需要鉴权）
opsRouter.use(opsAuthMiddleware);

// 获取当前配置（只读）
opsRouter.get("/config", (_req: Request, res: Response) => {
  const currentConfig = OpsConfigManager.getCurrentConfig();

  res.json({
    success: true,
    data: currentConfig,
  });
});

// 更新配置
opsRouter.post("/config", (req: Request, res: Response) => {
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

  // 返回更新后的完整配置
  res.json({
    success: true,
    message: "Configuration updated successfully",
    data: OpsConfigManager.getCurrentConfig(),
  });
});

// 获取可修改的配置项白名单
opsRouter.get("/config/schema", (_req: Request, res: Response) => {
  const schema = {
    logLevel: {
      key: "LOG_LEVEL",
      type: "string",
      enum: ["error", "warn", "info", "debug"],
      description: "日志级别",
    },
    webSearchMaxKeyword: {
      key: "WEB_SEARCH_MAX_KEYWORD",
      type: "number",
      min: 1,
      description: "联网搜索最大关键词数量",
    },
    webSearchForceSearch: {
      key: "WEB_SEARCH_FORCE_SEARCH",
      type: "boolean",
      description: "是否强制开启联网搜索能力",
    },
    webSearchLimit: {
      key: "WEB_SEARCH_LIMIT",
      type: "number",
      min: 1,
      description: "每次搜索返回的网页数量",
    },
    webSearchCountry: {
      key: "WEB_SEARCH_COUNTRY",
      type: "string",
      description: "搜索地理位置 - 国家",
    },
    webSearchRegion: {
      key: "WEB_SEARCH_REGION",
      type: "string",
      description: "搜索地理位置 - 省份/地区",
    },
    webSearchCity: {
      key: "WEB_SEARCH_CITY",
      type: "string",
      description: "搜索地理位置 - 城市",
    },
    monitorFlushIntervalMs: {
      key: "MONITOR_FLUSH_INTERVAL_MS",
      type: "number",
      min: 50,
      description: "监控异步写入队列的刷新间隔（毫秒）",
    },
    monitorRetentionDays: {
      key: "MONITOR_RETENTION_DAYS",
      type: "number",
      min: 1,
      description: "监控数据保留天数",
    },
    monitorFlushBatchSize: {
      key: "MONITOR_FLUSH_BATCH_SIZE",
      type: "number",
      min: 1,
      description: "监控异步写入批量大小",
    },
    monitorQueueMaxSize: {
      key: "MONITOR_QUEUE_MAX_SIZE",
      type: "number",
      min: 1,
      description: "监控异步队列最大长度",
    },
    upstreamTimeoutMs: {
      key: "UPSTREAM_TIMEOUT_MS",
      type: "number",
      min: 1000,
      description: "上游请求超时时间（毫秒），同时应用于主代理和 token-plan",
    },
    debugMaxRecords: {
      key: "DEBUG_MAX_RECORDS",
      type: "number",
      min: 1,
      description: "调试记录最大条数（环形缓冲区容量）",
    },
    debugMaxBodySize: {
      key: "DEBUG_MAX_BODY_SIZE",
      type: "number",
      min: 1024,
      description: "调试记录单条请求/响应体最大字节数",
    },
    debugMaxMediaBytes: {
      key: "DEBUG_MAX_MEDIA_BYTES",
      type: "number",
      min: 1024,
      description: "调试模式媒体资源缓存最大字节数",
    },
  };

  res.json({
    success: true,
    data: schema,
  });
});

// 服务状态
opsRouter.get("/status", (_req: Request, res: Response) => {
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
    },
  });
});

// 停机（graceful shutdown）
opsRouter.post("/shutdown", (req: Request, res: Response) => {
  logger.info("Ops shutdown requested", {
    ip: req.ip,
  });

  // 立即返回响应
  res.json({
    success: true,
    message: "Shutdown initiated",
  });

  // 延迟执行，确保响应已发送
  setTimeout(() => {
    requestShutdown();
  }, 100);
});

// 重启
opsRouter.post("/restart", (req: Request, res: Response) => {
  logger.info("Ops restart requested", {
    ip: req.ip,
    watcherActive: isWatcherActive(),
  });

  // 立即返回响应
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
