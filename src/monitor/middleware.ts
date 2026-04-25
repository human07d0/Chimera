import { Request, Response, NextFunction } from "express";
import { config } from "../config";
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
  const originalEnd = res.end.bind(res) as (...args: any[]) => Response;

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

    const size =
      typeof chunk === "string"
        ? Buffer.byteLength(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk.length
          : 0;
    bytesOut += size;

    if (firstTokenMs === null && size > 0) {
      firstTokenMs = Date.now() - tsStart;
    }

    if (typeof chunk === "string") {
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataContent = line.slice("data: ".length);
        if (!dataContent || dataContent === "[DONE]") continue;

        try {
          const parsed = JSON.parse(dataContent) as Record<string, unknown>;
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
          // ignore invalid chunk json
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
      (res.locals.upstreamModel as string | undefined) || config.upstream.defaultModel;
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
        (res.locals.upstreamModel as string | undefined) || config.upstream.defaultModel,
      stream,
      chunks,
      bytes_out: bytesOut,
      first_token_ms: firstTokenMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_prompt_tokens: cachedPromptTokens,
      cost,
      error_type: errorType,
      source: ((res.locals.source as string) || "main") as "main" | "token-plan",
    });

    return originalEnd(...args);
  };

  next();
}