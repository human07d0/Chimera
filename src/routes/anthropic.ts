// src/routes/anthropic.ts
import { Router, Request, Response } from "express";
import { modelRegistry } from "../providers/registry";
import { applyDefaults } from "../proxy/applyDefaults";
import { pipeSSEStream } from "../proxy/streaming";
import { logger } from "../utils/logger";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { sanitizeForLog } from "../utils/sanitizeForLog";
import { generateRequestId } from "../utils/requestId";

export const anthropicRouter: import("express").Router = Router();

anthropicRouter.post("/messages", async (req: Request, res: Response) => {
  const requestId = generateRequestId();
  res.locals.requestId = requestId;

  const startTime = Date.now();

  const clientBody = req.body as Record<string, unknown>;

  if (!clientBody || typeof clientBody !== "object") {
    sendAnthropicError(res, 400, "invalid_request", "Request body must be a JSON object");
    return;
  }

  if (!clientBody["model"]) {
    sendAnthropicError(res, 400, "invalid_request", "Missing required parameter: model");
    return;
  }

  if (!Array.isArray(clientBody["messages"]) || (clientBody["messages"] as unknown[]).length === 0) {
    sendAnthropicError(res, 400, "invalid_request", "Missing or empty required parameter: messages");
    return;
  }

  const endpointPrefix = extractEndpointPrefix(req);

  const resolved = modelRegistry.lookup(clientBody["model"] as string, endpointPrefix);
  if (!resolved) {
    sendAnthropicError(
      res,
      404,
      "model_not_found",
      `The model '${clientBody["model"]}' does not exist.`,
    );
    return;
  }

  const anthropicBase = resolved.providerConfig.anthropic_url ?? resolved.providerConfig.base_url;
  const url = resolved.handler.getAnthropicUrl(anthropicBase);
  if (!url) {
    sendAnthropicError(
      res,
      404,
      "invalid_request",
      `The model '${clientBody["model"]}' does not support Anthropic messages API.`,
    );
    return;
  }

  const isStreaming = clientBody["stream"] === true;

  logger.info("Incoming Anthropic request", {
    requestId,
    model: clientBody["model"],
    upstreamModel: resolved.modelConfig.upstream,
    provider: resolved.providerConfig.name,
    stream: isStreaming,
  });

  res.locals.virtualModelId = resolved.modelConfig.id;
  res.locals.providerName = resolved.providerConfig.name;
  res.locals.upstreamModel = resolved.modelConfig.upstream;

  // Pipeline: clone → swap model → apply defaults → transform
  const originalClientBody = { ...clientBody };
  const body = { ...clientBody };
  body["model"] = resolved.modelConfig.upstream;

  applyDefaults(body, resolved.modelConfig.default, originalClientBody);
  resolved.handler.transformRequest(body, resolved.modelConfig, originalClientBody, resolved.providerConfig);

  const authHeaders: Record<string, string> = {
    [resolved.providerConfig.auth_header]:
      resolved.providerConfig.auth_prefix + resolved.providerConfig.api_key,
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
  };

  // Forward Anthropic-specific headers
  const anthropicVersion = req.headers["anthropic-version"];
  if (anthropicVersion) {
    authHeaders["anthropic-version"] = Array.isArray(anthropicVersion)
      ? anthropicVersion.join(", ")
      : anthropicVersion;
  }
  const anthropicBeta = req.headers["anthropic-beta"];
  if (anthropicBeta) {
    authHeaders["anthropic-beta"] = Array.isArray(anthropicBeta)
      ? anthropicBeta.join(", ")
      : anthropicBeta;
  }

  let upstreamResponse: globalThis.Response;
  try {
    upstreamResponse = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      },
      resolved.providerConfig.timeout,
    );
  } catch (fetchErr) {
    const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    const isTimeout = message.includes("timed out") || message.includes("timeout");
    logger.error("Upstream fetch failed", { requestId, error: message });
    sendAnthropicError(
      res,
      502,
      isTimeout ? "rate_limit_error" : "upstream_error",
      isTimeout ? "Request to upstream API timed out" : `Failed to reach upstream API: ${message}`,
    );
    return;
  }

  if (!upstreamResponse.ok) {
    const errorStatus = upstreamResponse.status;
    let errorBody: unknown;
    try {
      errorBody = await upstreamResponse.json();
    } catch {
      errorBody = {
        message: await upstreamResponse.text().catch((textErr) => {
          logger.warn("Failed to read upstream error body as text", {
            requestId,
            status: errorStatus,
            textReadError: textErr instanceof Error ? textErr.message : String(textErr),
          });
          return "Unknown error";
        }),
      };
    }

    logger.warn("Upstream returned error", {
      requestId,
      status: errorStatus,
      body: sanitizeForLog(errorBody),
    });

    const anthropicError = convertUpstreamError(errorBody, errorStatus);
    res.status(errorStatus).json(anthropicError);
    return;
  }

  if (isStreaming) {
    res.setHeader("X-Request-Id", requestId);

    const usageRef: { inputTokens?: number; outputTokens?: number; cacheHit?: boolean } = {};

    await pipeSSEStream(upstreamResponse, res, resolved.modelConfig.id, {
      skipEmptyLines: false,
      sendErrorChunk: false,
      onChunk: (line) => {
        if (line.startsWith("data:")) {
          const dataContent = line.slice("data:".length).trimStart();
          try {
            const parsed = JSON.parse(dataContent) as Record<string, unknown>;
            if (parsed["type"] === "message_start") {
              const message = parsed["message"] as Record<string, unknown> | undefined;
              if (message) {
                message["model"] = resolved.modelConfig.id;
              }
            }
            if (parsed["type"] === "message_delta") {
              const usage = parsed["usage"] as Record<string, unknown> | undefined;
              if (usage) {
                if (typeof usage["input_tokens"] === "number") {
                  usageRef.inputTokens = usage["input_tokens"];
                }
                if (typeof usage["output_tokens"] === "number") {
                  usageRef.outputTokens = usage["output_tokens"];
                }
                if (typeof usage["cache_read_input_tokens"] === "number" && usage["cache_read_input_tokens"] > 0) {
                  usageRef.cacheHit = true;
                }
              }
            }
            return `data: ${JSON.stringify(parsed)}`;
          } catch {
            return line;
          }
        }
        return line;
      },
      usageRef,
    });

    logger.info("Anthropic streaming request completed", {
      requestId,
      durationMs: Date.now() - startTime,
      upstreamModel: resolved.modelConfig.upstream,
    });
  } else {
    const responseBody = (await upstreamResponse.json()) as Record<string, unknown>;
    responseBody["model"] = resolved.modelConfig.id;
    res.json(responseBody);

    logger.info("Anthropic non-streaming request completed", {
      requestId,
      durationMs: Date.now() - startTime,
      upstreamModel: resolved.modelConfig.upstream,
    });
  }
});

anthropicRouter.get("/messages", (_req: Request, res: Response) => {
  res.status(405).json({
    type: "invalid_request",
    error: {
      type: "invalid_request",
      message: "Anthropic Messages API only supports POST method. Use POST /anthropic/v1/messages.",
    },
  });
});

function extractEndpointPrefix(req: Request): string {
  const baseUrl = req.baseUrl.replace("/playground/api", "");
  const match = baseUrl.match(/^(.*?)\/(?:v1|anthropic\/v1)$/);
  return match ? match[1] : "";
}

function sendAnthropicError(
  res: Response,
  status: number,
  type: string,
  message: string,
): void {
  res.status(status).json({
    type: "error",
    error: {
      type,
      message,
    },
  });
}

function convertUpstreamError(
  errorBody: unknown,
  status: number,
): { type: string; error: { type: string; message: string } } {
  if (typeof errorBody !== "object" || errorBody === null) {
    return {
      type: "error",
      error: {
        type: "upstream_error",
        message: `Upstream error (${status})`,
      },
    };
  }

  const err = errorBody as Record<string, unknown>;
  const upstreamError = err["error"] as Record<string, unknown> | undefined;

  return {
    type: "error",
    error: {
      type: (upstreamError?.["type"] as string) || getErrorTypeFromStatus(status),
      message: (upstreamError?.["message"] as string) || (err["message"] as string) || `Upstream error (${status})`,
    },
  };
}

function getErrorTypeFromStatus(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "upstream_error";
  return "invalid_request";
}
