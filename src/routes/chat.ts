import { Router, Request, Response } from "express";
import { config } from "../config";
import { findVirtualModel } from "../models/presets";
import { transformRequest, transformResponse, ChatCompletionRequest } from "../proxy/transformer";
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

  const clientBody = req.body as ChatCompletionRequest;

  // ------------------------------------------------------------------
  // 1. 校验基本参数
  // ------------------------------------------------------------------
  if (!clientBody || typeof clientBody !== "object") {
    sendError(res, 400, "invalid_request_error", "Request body must be a JSON object");
    return;
  }

  if (!clientBody.model) {
    sendError(res, 400, "invalid_request_error", "Missing required parameter: model");
    return;
  }

  if (!Array.isArray(clientBody.messages) || clientBody.messages.length === 0) {
    sendError(res, 400, "invalid_request_error", "Missing or empty required parameter: messages");
    return;
  }

  // ------------------------------------------------------------------
  // 2. 查找虚拟模型
  // ------------------------------------------------------------------
  const virtualModel = findVirtualModel(clientBody.model);
  if (!virtualModel) {
    sendError(
      res,
      404,
      "invalid_request_error",
      `The model '${clientBody.model}' does not exist. ` +
        `Available models can be retrieved via GET /v1/models.`,
      "model_not_found"
    );
    return;
  }

  const isStreaming = clientBody.stream === true;

  logger.info("Incoming request", {
    requestId,
    model: clientBody.model,
    upstreamModel: virtualModel.upstreamModel,
    features: virtualModel.features,
    stream: isStreaming,
    messageCount: clientBody.messages.length,
  });

  // ------------------------------------------------------------------
  // 3. 构造上游请求体
  // ------------------------------------------------------------------
  const upstreamBody = transformRequest(
    clientBody,
    virtualModel.features,
    virtualModel.upstreamModel
  );
  res.locals.upstreamModel = virtualModel.upstreamModel;

  // ------------------------------------------------------------------
  // 4. 调用上游 API
  // ------------------------------------------------------------------
  const upstreamUrl = `${config.upstream.baseUrl}/v1/chat/completions`;

  let upstreamResponse: globalThis.Response;
  try {
    upstreamResponse = await fetchWithTimeout(
      upstreamUrl,
      {
        method: "POST",
        headers: {
          "api-key": config.mimoApiKey,
          "Content-Type": "application/json",
          // 转发一些有用的追踪头
          "X-Request-Id": requestId,
        },
        body: JSON.stringify(upstreamBody),
      },
      config.upstream.timeout
    );
  } catch (fetchErr) {
    const message =
      fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    const isTimeout = message.includes("timed out") || message.includes("timeout");
    logger.error("Upstream fetch failed", { requestId, error: message });
    sendError(
      res,
      502,
      "upstream_error",
      isTimeout
        ? "Request to upstream API timed out"
        : `Failed to reach upstream API: ${message}`,
      isTimeout ? "timeout" : "connection_error"
    );
    return;
  }

  // ------------------------------------------------------------------
  // 5. 处理上游错误响应
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

    // 原样透传上游错误（已是 OpenAI 兼容格式）
    res.status(errorStatus).json(errorBody);
    return;
  }

  // ------------------------------------------------------------------
  // 6. 流式 vs 非流式处理
  // ------------------------------------------------------------------
  if (isStreaming) {
    const { inputTokens, outputTokens, cacheHit } = await pipeSSEStream(upstreamResponse, res, virtualModel.id);
    logger.info("Streaming request completed", {
      requestId,
      durationMs: Date.now() - startTime,
      upstreamModel: virtualModel.upstreamModel,
      inputTokens,
      outputTokens,
      cacheHit,
    });
  } else {
    let responseBody: Record<string, unknown>;
    try {
      responseBody = (await upstreamResponse.json()) as Record<string, unknown>;
    } catch (parseErr) {
      logger.error("Failed to parse upstream JSON response", {
        requestId,
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      sendError(res, 502, "upstream_error", "Upstream returned invalid JSON");
      return;
    }

    const transformed = transformResponse(responseBody, virtualModel.id);
    res.json(transformed);

    logger.info("Non-streaming request completed", {
      requestId,
      durationMs: Date.now() - startTime,
      upstreamModel: virtualModel.upstreamModel,
      usage: responseBody["usage"] ?? null,
    });
  }
});

// --------------------------------------------------------------------------
// 工具函数
// --------------------------------------------------------------------------

function sendError(
  res: Response,
  status: number,
  type: string,
  message: string,
  code?: string
): void {
  res.status(status).json({
    error: {
      message,
      type,
      ...(code ? { code } : {}),
    },
  });
}



