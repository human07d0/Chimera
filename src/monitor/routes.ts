import { Request, Response, Router } from "express";
import { config } from "../config";
import { logger } from "../utils/logger";
import { extractApiKey } from "../utils/auth";
import { MonitorEvent } from "./storage";
import { getStorage } from "./storage/factory";

// 创建监控路由 - 添加类型注解以解决编译错误
export const monitorRouter: Router = Router();

function parseQueryInt(value: unknown, defaultValue: number): number {
  if (typeof value !== "string") {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseBodyInt(value: unknown, defaultValue: number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : defaultValue;
  }

  if (typeof value !== "string") {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseModelParam(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const model = value.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    return undefined;
  }

  return model;
}

function parseSourceParam(value: unknown): "main" | "token-plan" | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "main" || value === "token-plan") return value;
  return undefined;
}

function isPruneAuthorized(req: Request): boolean {
  // 默认仅开发环境开放，避免匿名误删
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  // 非开发环境必须提供并匹配 PROXY_API_KEY
  if (!config.proxyApiKey) {
    return false;
  }

  const providedKey = extractApiKey(req);
  return providedKey === config.proxyApiKey;
}

// 获取趋势数据
monitorRouter.get("/trend", (req: Request, res: Response) => {
  try {
    const days = parseQueryInt(req.query.days, 3);
    const model = parseModelParam(req.query.model);
    const source = parseSourceParam(req.query.source);
    const granularity = (typeof req.query.granularity === "string" && (req.query.granularity === "hour" || req.query.granularity === "6h" || req.query.granularity === "day")
      ? req.query.granularity
      : "day") as "hour" | "6h" | "day";

    const storage = getStorage();
    const buckets = storage.trend({ days, model, source, granularity });

    res.json({ success: true, data: { buckets } });
  } catch (_error) {
    res.status(500).json({
      success: false,
      error: "获取趋势数据失败",
    });
  }
});

// 获取监控统计数据
monitorRouter.get("/stats", (req: Request, res: Response) => {
  try {
    const days = parseQueryInt(req.query.days, 3);
    const model = parseModelParam(req.query.model);
    const source = parseSourceParam(req.query.source);

    const storage = getStorage();
    const stats = storage.stats({ days, model, source });

    res.json({
      success: true,
      data: stats,
    });
  } catch (_error) {
    res.status(500).json({
      success: false,
      error: "获取统计数据失败",
    });
  }
});

// 获取调用详情
monitorRouter.get("/calls", (req: Request, res: Response) => {
  try {
    const days = parseQueryInt(req.query.days, 3);
    const limit = parseQueryInt(req.query.limit, 100);
    const offset = parseQueryInt(req.query.offset, 0);
    const model = parseModelParam(req.query.model);

    const storage = getStorage();
    const events = storage.query({ days, limit, offset, model });

    // 前端兼容：保持旧版字段（timestamp/model/inputTokens/...）
    const calls = events.map((event: MonitorEvent) => ({
      id: event.request_id,
      timestamp: new Date(event.ts_start).toISOString(),
      model: event.model_requested,
      inputTokens: event.input_tokens,
      outputTokens: event.output_tokens,
      cachedPromptTokens: event.cached_prompt_tokens,
      cost: event.cost,
      duration: event.latency_ms,
      // 新字段（供后续升级使用）
      request_id: event.request_id,
      ts_start: event.ts_start,
      ts_end: event.ts_end,
      latency_ms: event.latency_ms,
      path: event.path,
      method: event.method,
      status_code: event.status_code,
      model_requested: event.model_requested,
      model_upstream: event.model_upstream,
      stream: event.stream,
      chunks: event.chunks,
      bytes_out: event.bytes_out,
      first_token_ms: event.first_token_ms,
      input_tokens: event.input_tokens,
      output_tokens: event.output_tokens,
      cached_prompt_tokens: event.cached_prompt_tokens,
      error_type: event.error_type,
      source: event.source,
    }));

    res.json({
      success: true,
      data: calls,
    });
  } catch (_error) {
    res.status(500).json({
      success: false,
      error: "获取调用详情失败",
    });
  }
});

// 手动触发数据清理（用于测试）
monitorRouter.post("/prune", (req: Request, res: Response) => {
  if (!isPruneAuthorized(req)) {
    logger.warn("Blocked unauthorized monitor prune request", {
      ip: req.ip,
      nodeEnv: process.env.NODE_ENV || "undefined",
    });
    res.status(403).json({
      success: false,
      error: "forbidden",
    });
    return;
  }

  try {
    const days = parseBodyInt((req.body as { days?: unknown } | undefined)?.days, 30);

    const storage = getStorage();
    const deletedCount = storage.prune(days);

    res.json({
      success: true,
      data: { deletedCount },
    });
  } catch (_error) {
    res.status(500).json({
      success: false,
      error: "清理数据失败",
    });
  }
});
