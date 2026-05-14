// src/routes/chat.ts
import { Router, Request, Response } from "express";
import { modelRegistry } from "../providers/registry";
import { applyDefaults } from "../proxy/applyDefaults";
import { pipeSSEStream } from "../proxy/streaming";
import { logger } from "../utils/logger";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { sanitizeForLog } from "../utils/sanitizeForLog";
import { generateRequestId } from "../utils/requestId";

export const chatRouter: import("express").Router = Router();

chatRouter.post("/chat/completions", async (req: Request, res: Response) => {
  const requestId = generateRequestId();
  res.locals.requestId = requestId;

  const startTime = Date.now();

  const clientBody = req.body as Record<string, unknown>;

  if (!clientBody || typeof clientBody !== "object") {
    sendChatError(res, 400, "invalid_request_error", "Request body must be a JSON object");
    return;
  }

  if (!clientBody["model"]) {
    sendChatError(res, 400, "invalid_request_error", "Missing required parameter: model");
    return;
  }

  if (!Array.isArray(clientBody["messages"]) || (clientBody["messages"] as unknown[]).length === 0) {
    sendChatError(res, 400, "invalid_request_error", "Missing or empty required parameter: messages");
    return;
  }

  const endpointPrefix = extractEndpointPrefix(req);

  const resolved = modelRegistry.lookup(clientBody["model"] as string, endpointPrefix);
  if (!resolved) {
    sendChatError(
      res,
      404,
      "invalid_request_error",
      `The model '${clientBody["model"]}' does not exist. ` +
        `Available models can be retrieved via GET /v1/models.`,
      "model_not_found",
    );
    return;
  }

  const url = resolved.handler.getOpenAIUrl(resolved.providerConfig.base_url);
  if (!url) {
    sendChatError(
      res,
      404,
      "invalid_request_error",
      `The model '${clientBody["model"]}' does not support OpenAI chat completions.`,
      "model_not_found",
    );
    return;
  }

  const isStreaming = clientBody["stream"] === true;

  logger.info("Incoming request", {
    requestId,
    model: clientBody["model"],
    upstreamModel: resolved.modelConfig.upstream,
    provider: resolved.providerConfig.name,
    stream: isStreaming,
    messageCount: (clientBody["messages"] as unknown[]).length,
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
    sendChatError(
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

    const chatError = convertUpstreamError(errorBody, errorStatus);
    res.status(errorStatus).json(chatError);
    return;
  }

  if (isStreaming) {
    res.setHeader("X-Request-Id", requestId);

    await pipeSSEStream(upstreamResponse, res, resolved.modelConfig.id, {
      skipEmptyLines: false,
      sendErrorChunk: false,
    });

    logger.info("Streaming request completed", {
      requestId,
      durationMs: Date.now() - startTime,
      upstreamModel: resolved.modelConfig.upstream,
    });
  } else {
    const responseBody = (await upstreamResponse.json()) as Record<string, unknown>;
    responseBody["model"] = resolved.modelConfig.id;
    res.json(responseBody);

    logger.info("Non-streaming request completed", {
      requestId,
      durationMs: Date.now() - startTime,
      upstreamModel: resolved.modelConfig.upstream,
    });
  }
});

function extractEndpointPrefix(req: Request): string {
  const baseUrl = req.baseUrl;
  const match = baseUrl.match(/^(.*?)\/v1$/);
  return match ? match[1] : "";
}

function sendChatError(
  res: Response,
  status: number,
  type: string,
  message: string,
  code?: string,
): void {
  res.status(status).json({
    error: {
      message,
      type,
      code: code ?? null,
    },
  });
}

function convertUpstreamError(
  errorBody: unknown,
  status: number,
): { error: { message: string; type: string; code: string | null } } {
  if (typeof errorBody !== "object" || errorBody === null) {
    return {
      error: {
        message: `Upstream error (${status})`,
        type: "upstream_error",
        code: null,
      },
    };
  }

  const err = errorBody as Record<string, unknown>;
  const upstreamError = err["error"] as Record<string, unknown> | undefined;

  return {
    error: {
      message: (upstreamError?.["message"] as string) || (err["message"] as string) || `Upstream error (${status})`,
      type: (upstreamError?.["type"] as string) || getErrorTypeFromStatus(status),
      code: (upstreamError?.["code"] as string) ?? null,
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
