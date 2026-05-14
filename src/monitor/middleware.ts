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

  const usage = (payload as Record<string, unknown>)["usage"];
  if (!usage || typeof usage !== "object") {
    return { input_tokens: 0, output_tokens: 0, cached_prompt_tokens: 0 };
  }

  const usageObj = usage as Record<string, unknown>;
  const promptDetails = (usageObj["prompt_tokens_details"] ?? {}) as Record<string, unknown>;

  return {
    input_tokens:
      ((usageObj["prompt_tokens"] as number) ?? (usageObj["input_tokens"] as number) ?? 0),
    output_tokens:
      ((usageObj["completion_tokens"] as number) ?? (usageObj["output_tokens"] as number) ?? 0),
    cached_prompt_tokens: (promptDetails["cached_tokens"] as number) ?? 0,
  };
}

function validateSource(value: unknown): "main" | "token-plan" {
  if (value === "token-plan") return "token-plan";
  return "main";
}

export function monitorMiddleware(req: Request, res: Response, next: NextFunction): void {
  const monitoredPaths = new Set(["/chat/completions", "/messages"]);
  if (!monitoredPaths.has(req.path)) {
    next();
    return;
  }

  const tsStart = Date.now();
  const modelRequested = (req.body?.model as string) || "unknown";
  const method = req.method;
  const path = req.originalUrl || req.path;

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

    // 统一转换为 Buffer 以计算大小和解析 SSE
    let buf: Buffer;
    if (typeof chunk === "string") {
      buf = Buffer.from(chunk);
    } else if (Buffer.isBuffer(chunk)) {
      buf = chunk;
    } else if (chunk instanceof Uint8Array) {
      buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    } else {
      buf = Buffer.alloc(0);
    }
    bytesOut += buf.length;

    if (firstTokenMs === null && buf.length > 0) {
      firstTokenMs = Date.now() - tsStart;
    }

    const str = buf.toString("utf-8");
    if (str) {
      const lines = str.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataContent = line.slice("data: ".length);
        if (!dataContent || dataContent === "[DONE]") continue;

        try {
          const parsed = JSON.parse(dataContent) as Record<string, unknown>;
          const usage = extractUsage(parsed);
          inputTokens = usage.input_tokens ?? inputTokens;
          outputTokens = usage.output_tokens ?? outputTokens;
          cachedPromptTokens = usage.cached_prompt_tokens ?? cachedPromptTokens;

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
      path,
      method,
      status_code: res.statusCode,
      model_requested: modelRequested,
      model_upstream:
        (res.locals.upstreamModel as string | undefined) || "unknown",
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
      source: validateSource(res.locals.source),
    });

    return originalEnd(...args);
  };

  next();
}