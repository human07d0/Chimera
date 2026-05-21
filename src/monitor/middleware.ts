import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { storageWorker } from "./storage/worker";
import { calculateCost } from "./pricing";

function extractUsage(payload: unknown): {
  input_tokens: number;
  output_tokens: number;
  cached_prompt_tokens: number;
} {
  if (!payload || typeof payload !== "object") {
    return { input_tokens: 0, output_tokens: 0, cached_prompt_tokens: 0 };
  }

  const top = payload as Record<string, unknown>;

  let usageObj = top["usage"] as Record<string, unknown> | undefined;

  if (!usageObj || typeof usageObj !== "object") {
    const message = top["message"];
    if (message && typeof message === "object") {
      const msgUsage = (message as Record<string, unknown>)["usage"];
      if (msgUsage && typeof msgUsage === "object") {
        usageObj = msgUsage as Record<string, unknown>;
      }
    }
  }

  if (!usageObj || typeof usageObj !== "object") {
    return { input_tokens: 0, output_tokens: 0, cached_prompt_tokens: 0 };
  }

  const input_tokens =
    ((usageObj["prompt_tokens"] as number) ?? (usageObj["input_tokens"] as number) ?? 0);
  const output_tokens =
    ((usageObj["completion_tokens"] as number) ?? (usageObj["output_tokens"] as number) ?? 0);

  const promptDetails = (usageObj["prompt_tokens_details"] ?? {}) as Record<string, unknown>;
  const openaiCached = (promptDetails["cached_tokens"] as number) ?? 0;

  const anthropicCacheCreation = Math.max(Number(usageObj["cache_creation_input_tokens"]) || 0, 0);
  const anthropicCacheRead = Math.max(Number(usageObj["cache_read_input_tokens"]) || 0, 0);

  return {
    input_tokens,
    output_tokens,
    cached_prompt_tokens: openaiCached > 0
      ? openaiCached
      : anthropicCacheCreation + anthropicCacheRead,
  };
}

function validateSource(value: unknown): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return "unknown";
}

const MONITORED_PATHS = new Set(["/chat/completions", "/messages"]);

export function monitorMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!MONITORED_PATHS.has(req.path)) {
    next();
    return;
  }

  const tsStart = Date.now();
  const modelRequested = (req.body?.model as string) || "unknown";
  const method = req.method;
  const reqPath = req.originalUrl || req.path;

  const originalJson = res.json.bind(res);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedPromptTokens = 0;
  let stream = false;
  let chunks = 0;
  let bytesOut = 0;
  let firstTokenMs: number | null = null;
  let errorType: string | null = null;

  res.json = function (body: any): Response {
    const usage = extractUsage(body);
    inputTokens = usage.input_tokens;
    outputTokens = usage.output_tokens;
    cachedPromptTokens = usage.cached_prompt_tokens;

    const bodyError = body?.error;
    if (bodyError && typeof bodyError === "object" && typeof bodyError.type === "string") {
      errorType = bodyError.type;
    }

    return originalJson(body);
  };

  res.write = function (chunk: any, encoding?: any, callback?: any): boolean {
    stream = true;
    chunks += 1;

    let str: string;
    if (typeof chunk === "string") {
      bytesOut += Buffer.byteLength(chunk, "utf-8");
      str = chunk;
    } else if (Buffer.isBuffer(chunk)) {
      bytesOut += chunk.length;
      str = chunk.toString("utf-8");
    } else if (chunk instanceof Uint8Array) {
      bytesOut += chunk.byteLength;
      str = new TextDecoder("utf-8").decode(chunk);
    } else {
      bytesOut += 0;
      str = "";
    }

    if (firstTokenMs === null && str.length > 0) {
      firstTokenMs = Date.now() - tsStart;
    }
    if (str) {
      const lines = str.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataContent = line.slice("data: ".length);
        if (!dataContent || dataContent === "[DONE]") continue;

        try {
          const shared = (res as any)?.locals?._sseChunk;
          const parsed = shared?.parsed ?? JSON.parse(dataContent) as Record<string, unknown>;
          const usage = extractUsage(parsed);
          inputTokens = usage.input_tokens || inputTokens;
          outputTokens = usage.output_tokens || outputTokens;
          cachedPromptTokens = usage.cached_prompt_tokens || cachedPromptTokens;

          const chunkError = parsed["error"];
          if (chunkError && typeof chunkError === "object") {
            const chunkErrorType = (chunkError as Record<string, unknown>)["type"];
            if (typeof chunkErrorType === "string") {
              errorType = chunkErrorType;
            }
          }
        } catch {
          logger.debug("Monitor: skipping unparseable SSE chunk during token counting", {
            chunk: dataContent.slice(0, 120),
          });
        }
      }
    }
    
    return originalWrite.call(this, chunk, encoding, callback);
  };

  res.end = function (...args: any[]): Response {
    const tsEnd = Date.now();
    const latencyMs = tsEnd - tsStart;

    if (res.statusCode >= 400 && !errorType) {
      errorType = `http_${res.statusCode}`;
    }

    const requestId =
      (res.locals.requestId as string | undefined) ||
      req.headers["x-request-id"]?.toString() ||
      `monitor-${tsStart.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const upstreamModel =
      (res.locals.upstreamModel as string | undefined) || "unknown";
    const providerName =
      (res.locals.providerName as string | undefined) || "unknown";
    const cost = calculateCost(upstreamModel, inputTokens, cachedPromptTokens, outputTokens);

    storageWorker.append({
      request_id: requestId,
      ts_start: tsStart,
      ts_end: tsEnd,
      latency_ms: latencyMs,
      path: reqPath,
      method,
      status_code: res.statusCode,
      model_requested: modelRequested,
      model_upstream: upstreamModel,
      provider_name: providerName,
      stream,
      chunks,
      bytes_out: bytesOut,
      first_token_ms: firstTokenMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_prompt_tokens: cachedPromptTokens,
      cost,
      error_type: errorType,
      source: validateSource(res.locals.providerName),
    });

    return originalEnd(...args);
  };

  next();
}