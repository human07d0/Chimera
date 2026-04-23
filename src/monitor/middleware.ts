import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { storageWorker } from "./storage/worker";

interface PriceTier {
  threshold: number;
  inputPrice: number;
  cachedPrice: number;
  outputPrice: number;
}

interface ModelPricing {
  tiers: PriceTier[];
}

const PRICING: Record<string, ModelPricing> = {
  "mimo-v2-flash": {
    tiers: [
      { threshold: Infinity, inputPrice: 0.7, cachedPrice: 0.07, outputPrice: 2.1 },
    ],
  },
  "mimo-v2-pro": {
    tiers: [
      { threshold: 256_000, inputPrice: 7.0, cachedPrice: 1.4, outputPrice: 21.0 },
      { threshold: Infinity, inputPrice: 14.0, cachedPrice: 2.8, outputPrice: 42.0 },
    ],
  },
  "mimo-v2-omni": {
    tiers: [
      { threshold: 256_000, inputPrice: 2.8, cachedPrice: 0.56, outputPrice: 14.0 },
      { threshold: Infinity, inputPrice: 5.6, cachedPrice: 1.12, outputPrice: 28.0 },
    ],
  },
  "mimo-v2.5": {
    tiers: [
      { threshold: 256_000, inputPrice: 2.8, cachedPrice: 0.56, outputPrice: 14.0 },
      { threshold: Infinity, inputPrice: 5.6, cachedPrice: 1.12, outputPrice: 28.0 },
    ],
  },
  "mimo-v2.5-pro": {
    tiers: [
      { threshold: 256_000, inputPrice: 7.0, cachedPrice: 1.4, outputPrice: 21.0 },
      { threshold: Infinity, inputPrice: 14.0, cachedPrice: 2.8, outputPrice: 42.0 },
    ],
  },
};

function getTier(tokens: number, tiers: PriceTier[]): PriceTier {
  for (const tier of tiers) {
    if (tokens <= tier.threshold) return tier;
  }
  return tiers[tiers.length - 1];
}

function calculateCost(
  modelId: string,
  promptTokens: number,
  cachedPromptTokens: number,
  completionTokens: number
): number {
  const pricing = PRICING[modelId] || PRICING["mimo-v2-flash"];
  const inputTier = getTier(promptTokens, pricing.tiers);
  const outputTier = getTier(completionTokens, pricing.tiers);

  const paidPromptTokens = Math.max(promptTokens - cachedPromptTokens, 0);
  const cachedCost = (cachedPromptTokens / 1_000_000) * inputTier.cachedPrice;
  const promptCost = (paidPromptTokens / 1_000_000) * inputTier.inputPrice;
  const completionCost = (completionTokens / 1_000_000) * outputTier.outputPrice;
  return cachedCost + promptCost + completionCost;
}

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
    });

    return originalEnd(...args);
  };

  next();
}