import { Router, Request, Response, NextFunction } from "express";
import { config } from "../config";
import { findVirtualModel, VIRTUAL_MODELS } from "../models/presets";
import { logger } from "../utils/logger";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { sanitizeForLog } from "../utils/sanitizeForLog";

// Anthropic 请求体类型
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
anthropicRouter.post("/messages", async (req: Request, res: Response, next: NextFunction) => {
  const requestId = `proxy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();

  try {
    const clientBody = req.body as AnthropicMessagesRequest;

    // ------------------------------------------------------------------
    // 1. 校验基本参数
    // ------------------------------------------------------------------
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

    // ------------------------------------------------------------------
    // 2. 校验虚拟模型（用于日志和请求 ID）
    // ------------------------------------------------------------------
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

    // ------------------------------------------------------------------
    // 3. 直接透传到上游 MiMo Anthropic 接口
    // ------------------------------------------------------------------
    // 注意：小米上游 /anthropic/v1/messages 接口已经兼容 Anthropic 格式
    // 只需要将 model 替换为上游模型 ID，其他字段直接透传
    const upstreamBody = {
      ...clientBody,
      model: virtualModel.upstreamModel,
    };

    const upstreamUrl = `${config.upstream.anthropicBaseUrl}/messages`;

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

    // ------------------------------------------------------------------
    // 4. 处理上游响应
    // ------------------------------------------------------------------
    if (!upstreamResponse.ok) {
      const errorStatus = upstreamResponse.status;
      let errorBody: unknown;
      try {
        errorBody = await upstreamResponse.json();
      } catch {
        errorBody = { message: await upstreamResponse.text().catch(() => "Unknown error") };
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

    // ------------------------------------------------------------------
    // 5. 流式 vs 非流式处理
    // ------------------------------------------------------------------
    if (isStreaming) {
      // 流式：直接 pipe 上游 SSE 到客户端
      await pipeUpstreamStream(upstreamResponse, res, requestId);
      logger.info("Anthropic streaming request completed", {
        requestId,
        durationMs: Date.now() - startTime,
        upstreamModel: virtualModel.upstreamModel,
      });
    } else {
      // 非流式：直接透传 JSON 响应
      const responseBody = await upstreamResponse.json();
      res.json(responseBody);

      logger.info("Anthropic non-streaming request completed", {
        requestId,
        durationMs: Date.now() - startTime,
        upstreamModel: virtualModel.upstreamModel,
      });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET /anthropic/v1/messages (405 Method Not Allowed)
 * Anthropic API 仅支持 POST
 */
anthropicRouter.get("/messages", (_req: Request, res: Response) => {
  res.status(405).json({
    type: "invalid_request",
    error: {
      type: "invalid_request",
      message: "Anthropic Messages API only supports POST method. Use POST /anthropic/v1/messages.",
    },
  });
});

// --------------------------------------------------------------------------
// 工具函数
// --------------------------------------------------------------------------

/**
 * 直接 pipe 上游 SSE 流到客户端
 */
async function pipeUpstreamStream(
  upstreamResponse: globalThis.Response,
  res: Response,
  requestId: string
): Promise<void> {
  // 设置 SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Request-Id", requestId);
  res.flushHeaders();

  const reader = upstreamResponse.body?.getReader();
  if (!reader) {
    res.end();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      res.write(buffer);
      buffer = "";
    }
  } catch (err) {
    logger.error("Stream pipe error", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    reader.releaseLock();
  }

  res.end();
}

function sendAnthropicError(
  res: Response,
  status: number,
  type: string,
  message: string
): void {
  // Anthropic 官方错误格式：{ type: "error", error: { type, message } }
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

// Using shared utilities: fetchWithTimeout and sanitizeForLog


/**
 * GET /anthropic/v1/models
 * 返回 Anthropic 格式的虚拟模型列表
 */
anthropicRouter.get("/models", (_req: Request, res: Response) => {
  const models = VIRTUAL_MODELS.map((m) => ({
    name: m.id,
    display_name: m.description,
    description: m.description,
    input_token_limit: 200000,
    output_token_limit: 16384,
    thinking: {
      type: m.features.thinking ? "enabled" : "disabled",
    },
    search: m.features.search,
    json: m.features.json,
  }));

  res.json({ models });
});
