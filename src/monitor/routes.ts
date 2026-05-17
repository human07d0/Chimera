import { Request, Response, Router } from "express";
import { config } from "../config";
import { logger } from "../utils/logger";
import { extractApiKey } from "../utils/auth";
import { MonitorEvent } from "./storage";
import { getStorage } from "./storage/factory";

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

function parseSourceParam(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim();
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

function parseTimestampParam(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return undefined;
  return parsed;
}

monitorRouter.get("/trend", (req: Request, res: Response) => {
  let days = 3, start: number | undefined, end: number | undefined;
  let model: string | undefined, source: string | undefined;
  let granularity: "hour" | "6h" | "day" = "day";
  try {
    days = parseQueryInt(req.query.days, 3);
    start = parseTimestampParam(req.query.start);
    end = parseTimestampParam(req.query.end);
    model = parseModelParam(req.query.model);
    source = parseSourceParam(req.query.source);
    granularity = (typeof req.query.granularity === "string" && (req.query.granularity === "hour" || req.query.granularity === "6h" || req.query.granularity === "day")
      ? req.query.granularity
      : "day") as "hour" | "6h" | "day";

    const storage = getStorage();
    const buckets = storage.trend({ days, start, end, model, source, granularity });

    res.json({ success: true, data: { buckets } });
  } catch (err) {
    logger.error("Monitor trend query failed", {
      error: err instanceof Error ? err.message : String(err),
      days, start, end, model, source, granularity,
    });
    res.status(500).json({
      success: false,
      error: "获取趋势数据失败",
    });
  }
});

monitorRouter.get("/stats", (req: Request, res: Response) => {
  let days = 3, start: number | undefined, end: number | undefined;
  let model: string | undefined, source: string | undefined;
  try {
    days = parseQueryInt(req.query.days, 3);
    start = parseTimestampParam(req.query.start);
    end = parseTimestampParam(req.query.end);
    model = parseModelParam(req.query.model);
    source = parseSourceParam(req.query.source);

    const storage = getStorage();
    const stats = storage.stats({ days, start, end, model, source });

    res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    logger.error("Monitor stats query failed", {
      error: err instanceof Error ? err.message : String(err),
      days, start, end, model, source,
    });
    res.status(500).json({
      success: false,
      error: "获取统计数据失败",
    });
  }
});

monitorRouter.get("/token-trend", (req: Request, res: Response) => {
  let start: number | undefined, end: number | undefined;
  let source: string | undefined;
  try {
    start = parseTimestampParam(req.query.start);
    end = parseTimestampParam(req.query.end);
    source = parseSourceParam(req.query.source);

    const storage = getStorage();
    const buckets = storage.tokenTrend({ start, end, source });

    res.json({ success: true, data: { buckets } });
  } catch (err) {
    logger.error("Monitor token-trend query failed", {
      error: err instanceof Error ? err.message : String(err),
      start, end, source,
    });
    res.status(500).json({
      success: false,
      error: "获取 Token 趋势数据失败",
    });
  }
});

monitorRouter.get("/calls", (req: Request, res: Response) => {
  let days = 3, limit = 100, offset = 0;
  let model: string | undefined;
  try {
    days = parseQueryInt(req.query.days, 3);
    limit = parseQueryInt(req.query.limit, 100);
    offset = parseQueryInt(req.query.offset, 0);
    model = parseModelParam(req.query.model);

    logger.info("Monitor /calls request", { days, limit, offset, model });

    const storage = getStorage();
    const events = storage.query({ days, limit, offset, model });

    logger.info("Monitor /calls result", { eventCount: events.length });

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
  } catch (err) {
    logger.error("Monitor calls query failed", {
      error: err instanceof Error ? err.message : String(err),
      days, limit, offset, model,
    });
    res.status(500).json({
      success: false,
      error: "获取调用详情失败",
    });
  }
});

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

  let days = 30;
  try {
    days = parseBodyInt((req.body as { days?: unknown } | undefined)?.days, 30);

    const storage = getStorage();
    const deletedCount = storage.prune(days);

    res.json({
      success: true,
      data: { deletedCount },
    });
  } catch (err) {
    logger.error("Monitor prune failed", {
      error: err instanceof Error ? err.message : String(err),
      days,
    });
    res.status(500).json({
      success: false,
      error: "清理数据失败",
    });
  }
});
