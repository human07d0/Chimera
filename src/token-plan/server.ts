import express, { NextFunction, Request, Response, Router } from "express";

import { config } from "../config";
import { logger } from "../utils/logger";
import { extractApiKey } from "../utils/auth";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { generateRequestId } from "../utils/requestId";

// --------------------------------------------------------------------------
// 鉴权逻辑
// --------------------------------------------------------------------------

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!config.tokenPlan.proxyApiKey) {
    next();
    return;
  }

  const providedKey = extractApiKey(req);

  if (!providedKey) {
    res.status(401).json({
      error: {
        message:
          "Missing API key. Provide it via 'Authorization: Bearer <key>', 'api-key: <key>' or 'x-api-key: <key>' header.",
        type: "authentication_error",
        code: "missing_api_key",
      },
    });
    return;
  }

  if (providedKey !== config.tokenPlan.proxyApiKey) {
    res.status(401).json({
      error: {
        message: "Invalid API key.",
        type: "authentication_error",
        code: "invalid_api_key",
      },
    });
    return;
  }

  next();
}

// --------------------------------------------------------------------------
// 通用透传函数
// --------------------------------------------------------------------------

function getUpstreamApiKey(): string {
  return config.tokenPlan.mimoApiKey || config.mimoApiKey;
}
/**
 * 将客户端请求原样透传到上游，支持流式和非流式响应
 */
async function proxyPassthrough(
  req: Request,
  res: Response,
  upstreamBaseUrl: string,
  upstreamPath: string,
  requestId: string
): Promise<void> {
  // 将客户端请求的模型名写入 res.locals，供 debug/monitor 中间件读取
  res.locals.upstreamModel = req.body?.model || "unknown";

  const upstreamUrl = `${upstreamBaseUrl}${upstreamPath}`;
  const apiKey = getUpstreamApiKey();

  // 构造上游请求头：转发客户端原始 headers，替换鉴权
  const upstreamHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
  };

  // 转发客户端的 Authorization 头（使用上游 API Key）
  if (apiKey) {
    upstreamHeaders["api-key"] = apiKey;
  }

  // 转发其他有用的请求头
  const forwardHeaders = ["accept", "accept-encoding", "anthropic-version", "anthropic-beta"];
  for (const h of forwardHeaders) {
    const val = req.headers[h];
    if (val) {
      upstreamHeaders[h] = Array.isArray(val) ? val.join(", ") : val;
    }
  }

  let upstreamResponse: globalThis.Response;
  try {
    upstreamResponse = await fetchWithTimeout(
      upstreamUrl,
      {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify(req.body),
      },
      config.tokenPlan.timeout
    );
  } catch (fetchErr) {
    const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    const isTimeout = message.includes("timed out") || message.includes("timeout");
    logger.error("Token-plan upstream fetch failed", { requestId, error: message });
    res.status(502).json({
      error: {
        message: isTimeout
          ? "Request to upstream API timed out"
          : `Failed to reach upstream API: ${message}`,
        type: "upstream_error",
        code: isTimeout ? "timeout" : "connection_error",
      },
    });
    return;
  }

  // 处理上游错误响应
  if (!upstreamResponse.ok) {
    const errorStatus = upstreamResponse.status;
    let errorBody: unknown;
    try {
      errorBody = await upstreamResponse.json();
    } catch {
      errorBody = { message: await upstreamResponse.text().catch(() => "Unknown error") };
    }

    logger.warn("Token-plan upstream returned error", {
      requestId,
      status: errorStatus,
    });

    res.status(errorStatus).json(errorBody);
    return;
  }

  // 流式响应：直接 pipe
  const contentType = upstreamResponse.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream") || contentType.includes("text/plain")) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Request-Id", requestId);

    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      res.status(502).json({
        error: { message: "Upstream returned no body", type: "upstream_error" },
      });
      return;
    }

    let cancelled = false;
    const onClientClose = () => {
      cancelled = true;
      reader.cancel().catch(() => {});
    };
    res.on("close", onClientClose);

    try {
      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch (err) {
      if (cancelled) {
        logger.debug("Token-plan stream cancelled (client disconnected)", { requestId });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.writableEnded) {
          logger.error("Token-plan stream pipe error", { requestId, error: msg });
        }
      }
    } finally {
      res.off("close", onClientClose);
      reader.releaseLock();
      if (!res.writableEnded) {
        res.end();
      }
    }

    logger.info("Token-plan streaming request completed", { requestId });
    return;
  }

  // 非流式响应
  const responseBody = await upstreamResponse.json();
  res.setHeader("X-Request-Id", requestId);
  res.json(responseBody);

  logger.info("Token-plan non-streaming request completed", { requestId });
}

// --------------------------------------------------------------------------
// Express Router（挂载于主应用 /token-plan 路径下）
// --------------------------------------------------------------------------

/**
 * 创建 token-plan 透传路由器
 *
 * 返回 express.Router，在主应用中以 /token-plan 前缀挂载。
 * 复用主应用的 CORS、JSON 解析、请求日志等基础中间件。
 * 鉴权中间件由本 Router 自行管理（使用 TOKEN_PLAN_PROXY_API_KEY）。
 */
export function createTokenPlanRouter(): Router {
  const router = Router();

  // 鉴权中间件（作用于所有 token-plan 路由）
  router.use("/v1", authMiddleware);
  router.use("/anthropic", authMiddleware);

  // OpenAI 兼容格式: POST /v1/chat/completions
  router.post("/v1/chat/completions", async (req: Request, res: Response) => {
    const requestId = generateRequestId("tp");
    try {
      await proxyPassthrough(req, res, config.tokenPlan.baseUrl, "/v1/chat/completions", requestId);
    } catch (err) {
      logger.error("Token-plan /v1/chat/completions error", {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({
          error: { message: "Internal proxy error", type: "internal_error" },
        });
      }
    }
  });

  // Anthropic Messages API: POST /anthropic/v1/messages
  router.post("/anthropic/v1/messages", async (req: Request, res: Response) => {
    const requestId = generateRequestId("tp");
    try {
      await proxyPassthrough(req, res, config.tokenPlan.anthropicBaseUrl, "/v1/messages", requestId);
    } catch (err) {
      logger.error("Token-plan /anthropic/v1/messages error", {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({
          error: { message: "Internal proxy error", type: "internal_error" },
        });
      }
    }
  });

  // 404
  router.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        message: "The requested endpoint does not exist on token-plan proxy",
        type: "invalid_request_error",
        code: "endpoint_not_found",
      },
    });
  });

  // 全局错误处理
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("Token-plan unhandled error", {
      name: err.name,
      message: err.message,
    });
    if (!res.headersSent) {
      res.status(500).json({
        error: { message: "Internal proxy error", type: "internal_error" },
      });
    }
  });

  return router;
}