import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { debugStore } from "./store";

/**
 * 调试中间件：捕获完整的请求/响应体，存入内存环形缓冲区。
 * 仅作用于 /chat/completions 和 /messages 路径。
 * 需在 express.json() 之后、路由处理之前挂载。
 */
export function debugMiddleware(req: Request, res: Response, next: NextFunction): void {
  const monitoredPaths = new Set(["/chat/completions", "/messages"]);
  if (!monitoredPaths.has(req.path)) {
    next();
    return;
  }

  const tsStart = Date.now();
  const modelRequested = (req.body?.model as string) || "unknown";
  const method = req.method;
  const reqPath = req.originalUrl || req.path;
  const maxBodySize = config.debug.maxBodySize;

  // 捕获请求体
  let requestBodyStr: string;
  try {
    requestBodyStr = JSON.stringify(req.body ?? {});
  } catch {
    requestBodyStr = "{}";
  }
  if (requestBodyStr.length > maxBodySize) {
    requestBodyStr = requestBodyStr.slice(0, maxBodySize) + "...[truncated]";
  }

  const originalJson = res.json.bind(res);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res) as (...args: any[]) => Response;

  let stream = false;
  let responseBodyStr = "";
  let errorType: string | null = null;
  let errorBodyStr: string | null = null;
  const sseChunks: string[] = [];

  // 非流式：通过 res.json 捕获响应体
  res.json = function (body: any): Response {
    try {
      responseBodyStr = JSON.stringify(body);
    } catch {
      responseBodyStr = "[unserializable]";
    }
    if (responseBodyStr.length > maxBodySize) {
      responseBodyStr = responseBodyStr.slice(0, maxBodySize) + "...[truncated]";
    }

    if (body?.error && typeof body.error === "object") {
      errorType = (body.error.type as string) || `http_${res.statusCode}`;
      try {
        errorBodyStr = JSON.stringify(body.error);
      } catch {
        errorBodyStr = null;
      }
    }

    return originalJson(body);
  };

  // 流式：收集 SSE data chunks
  res.write = function (chunk: any, encoding?: any, callback?: any): boolean {
    stream = true;

    if (typeof chunk === "string") {
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataContent = line.slice("data: ".length);
        if (!dataContent || dataContent === "[DONE]") continue;
        sseChunks.push(dataContent);
      }
    }

    return originalWrite.call(this, chunk, encoding, callback);
  };

  // 终结：组装并存储调试事件
  res.end = function (...args: any[]): Response {
    const tsEnd = Date.now();

    // 流式场景：从收集的 chunks 组装响应体
    if (stream) {
      // 检查是否有错误 chunk
      for (const chunk of sseChunks) {
        try {
          const parsed = JSON.parse(chunk) as Record<string, unknown>;
          if (parsed["error"] && typeof parsed["error"] === "object") {
            const errObj = parsed["error"] as Record<string, unknown>;
            errorType = (errObj["type"] as string) || "upstream_error";
            errorBodyStr = JSON.stringify(errObj);
            break;
          }
        } catch {
          // ignore invalid JSON
        }
      }

      responseBodyStr = "[" + sseChunks.join(",") + "]";
      if (responseBodyStr.length > maxBodySize) {
        responseBodyStr = responseBodyStr.slice(0, maxBodySize) + "...[truncated]";
      }
    }

    // 非流式错误：如果 statusCode >= 400 但未提取到 errorType
    if (!stream && res.statusCode >= 400 && !errorType) {
      errorType = `http_${res.statusCode}`;
    }

    const requestId =
      (res.locals.requestId as string | undefined) ||
      req.headers["x-request-id"]?.toString() ||
      `debug-${tsStart.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const upstreamModel =
      (res.locals.upstreamModel as string | undefined) || config.upstream.defaultModel;

    debugStore.append({
      request_id: requestId,
      ts_start: tsStart,
      ts_end: tsEnd,
      path: reqPath,
      method,
      status_code: res.statusCode,
      model_requested: modelRequested,
      model_upstream: upstreamModel,
      stream,
      request_body: requestBodyStr,
      response_body: responseBodyStr,
      error_type: errorType,
      error_body: errorBodyStr,
    });

    return originalEnd(...args);
  };

  next();
}