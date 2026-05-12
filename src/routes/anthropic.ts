import { Router, Request, Response } from "express";
import { config } from "../config";
import { findVirtualModel, VIRTUAL_MODELS } from "../models/presets";
import { pipeSSEStream } from "../proxy/streaming";
import { logger } from "../utils/logger";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { sanitizeForLog } from "../utils/sanitizeForLog";
import { generateRequestId } from "../utils/requestId";

interface AnthropicMessagesRequest {
  model: string;
  messages: unknown[];
  stream?: boolean;
  max_tokens?: number;
  [key: string]: unknown;
}

export const anthropicRouter: import("express").Router = Router();

/**
 * POST /anthropic/v1/messages
 * Anthropic Messages API 兼容接口 - 直接透传到上游
 */
anthropicRouter.post("/messages", async (req: Request, res: Response) => {
  const requestId = generateRequestId();
  const startTime = Date.now();

  const clientBody = req.body as AnthropicMessagesRequest;

  if (!clientBody || typeof clientBody !== "object") {
    sendAnthropicError(res, 400, "invalid_request", "Request body must be a JSON object");
    return;
  }

  if (!clientBody.model) {
    sendAnthropicError(res, 400, "invalid_request", "Missing required parameter: model");
    return;
  }

  if (!Array.isArray(clientBody.messages) || clientBody.messages.length === 0) {
    sendAnthropicError(res, 400, "invalid_request", "Missing or empty required parameter: messages");
    return;
  }

  if (!clientBody.max_tokens || clientBody.max_tokens < 1) {
    sendAnthropicError(res, 400, "invalid_request", "max_tokens is required and must be positive");
    return;
  }

  res.locals.requestId = requestId;
  const virtualModel = findVirtualModel(clientBody.model);
  if (!virtualModel) {
    sendAnthropicError(
      res,
      404,
      "model_not_found",
      `The model '${clientBody.model}' does not exist. ` +
        `Available models can be retrieved via GET /v1/models.`
    );
    return;
  }

  const isStreaming = clientBody.stream === true;
  res.locals.upstreamModel = virtualModel.upstreamModel;

  logger.info("Anthropic incoming request (passthrough)", {
    requestId,
    model: clientBody.model,
    upstreamModel: virtualModel.upstreamModel,
    features: virtualModel.features,
    stream: isStreaming,
    messageCount: clientBody.messages.length,
  });

  // 注意：小米上游 /anthropic/v1/messages 接口已经兼容 Anthropic 格式
  // 只需要将 model 替换为上游模型 ID，其他字段直接透传
  const upstreamBody = {
    ...clientBody,
    model: virtualModel.upstreamModel,
  };

  const upstreamUrl = `${config.upstream.anthropicBaseUrl}/v1/messages`;

  let upstreamResponse: globalThis.Response;
  try {
    upstreamResponse = await fetchWithTimeout(
      upstreamUrl,
      {
        method: "POST",
        headers: {
          "api-key": config.mimoApiKey,
          "x-api-key": config.mimoApiKey,
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
        body: JSON.stringify(upstreamBody),
      },
      config.upstream.timeout
    );
  } catch (fetchErr) {
    const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    const isTimeout = message.includes("timed out") || message.includes("timeout");
    logger.error("Upstream fetch failed", { requestId, error: message });
    sendAnthropicError(
      res,
      502,
      isTimeout ? "rate_limit_error" : "upstream_error",
      isTimeout ? "Request to upstream API timed out" : `Failed to reach upstream API: ${message}`
    );
    return;
  }

  if (!upstreamResponse.ok) {
    const errorStatus = upstreamResponse.status;
    let errorBody: unknown;
    try {
      errorBody = await upstreamResponse.json();
    } catch {
      // JSON parse failure is logged below by the existing logger.warn("Upstream returned error", ...)
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

    // 转换为 Anthropic 错误格式
    const anthropicError = convertUpstreamError(errorBody, errorStatus);
    res.status(errorStatus).json(anthropicError);
    return;
  }

  if (isStreaming) {
    res.setHeader("X-Request-Id", requestId);
    await pipeSSEStream(upstreamResponse, res, virtualModel.upstreamModel, {
      skipEmptyLines: false,
      sendErrorChunk: false,
      onChunk: (line) => line,
    });
    logger.info("Anthropic streaming request completed", {
      requestId,
      durationMs: Date.now() - startTime,
      upstreamModel: virtualModel.upstreamModel,
    });
  } else {
    const responseBody = await upstreamResponse.json();
    res.json(responseBody);

    logger.info("Anthropic non-streaming request completed", {
      requestId,
      durationMs: Date.now() - startTime,
      upstreamModel: virtualModel.upstreamModel,
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

function sendAnthropicError(
  res: Response,
  status: number,
  type: string,
  message: string
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
  status: number
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

anthropicRouter.get("/models", (_req: Request, res: Response) => {
  const models = VIRTUAL_MODELS.map((m) => ({
    name: m.id,
    display_name: m.description,
    description: m.description,
    input_token_limit: m.contextLength,
    output_token_limit: m.maxOutputTokens,
    thinking: {
      type: m.features.thinking ? "enabled" : "disabled",
    },
    search: m.features.search,
    json: m.features.json,
  }));

  res.json({ models });
});
