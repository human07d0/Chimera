import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { debugStore } from "./store";

/**
 * 将 SSE chunk 数组解析并拼接为完整的响应对象 JSON 字符串。
 * 支持 OpenAI 和 Anthropic 两种流式格式。
 */
export function assembleStreamResponse(sseChunks: string[]): string {
  let format: "openai" | "anthropic" | null = null;
  let id: string | undefined;
  let model: string | undefined;
  let usage: Record<string, unknown> | undefined;

  // OpenAI 累积字段
  let content = "";
  let reasoningContent = "";
  let hasContent = false;
  let hasReasoning = false;

  // Anthropic 累积字段
  let anthropicText = "";
  let anthropicThinking = "";
  let stopReason: string | undefined;
  let hasAnthropicText = false;
  let hasAnthropicThinking = false;

  for (const chunk of sseChunks) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(chunk);
    } catch {
      // 非 JSON chunk，回退为原始拼接
      return "[" + sseChunks.join(",") + "]";
    }

    // 检测格式
    if (!format) {
      if (parsed.choices !== undefined) {
        format = "openai";
      } else if (parsed.type !== undefined) {
        format = "anthropic";
      }
    }

    if (format === "openai") {
      // 收集元数据
      if (parsed.id && !id) id = parsed.id as string;
      if (parsed.model && !model) model = parsed.model as string;
      if (parsed.usage) usage = parsed.usage as Record<string, unknown>;

      // 提取 delta 内容
      const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
      if (choices?.[0]) {
        const delta = choices[0].delta as Record<string, unknown> | undefined;
        if (delta) {
          if (typeof delta.content === "string" && delta.content) {
            content += delta.content;
            hasContent = true;
          }
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
            reasoningContent += delta.reasoning_content;
            hasReasoning = true;
          }
        }
      }
    } else if (format === "anthropic") {
      const type = parsed.type as string;

      // message_start 中提取 id、model
      if (type === "message_start") {
        const msg = parsed.message as Record<string, unknown> | undefined;
        if (msg) {
          if (msg.id && !id) id = msg.id as string;
          if (msg.model && !model) model = msg.model as string;
        }
      }

      // content_block_delta 中提取文本/思考内容
      if (type === "content_block_delta") {
        const delta = parsed.delta as Record<string, unknown> | undefined;
        if (delta) {
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            anthropicText += delta.text;
            hasAnthropicText = true;
          }
          if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
            anthropicThinking += delta.thinking;
            hasAnthropicThinking = true;
          }
        }
      }

      // message_delta 中提取 stop_reason 和 usage
      if (type === "message_delta") {
        const delta = parsed.delta as Record<string, unknown> | undefined;
        if (delta?.stop_reason) stopReason = delta.stop_reason as string;
        if (parsed.usage) usage = parsed.usage as Record<string, unknown>;
      }
    }
  }

  // 组装结果
  if (format === "openai") {
    const message: Record<string, unknown> = { role: "assistant" };
    if (hasContent) message.content = content;
    if (hasReasoning) message.reasoning_content = reasoningContent;

    const result: Record<string, unknown> = {
      id: id || "",
      object: "chat.completion",
      model: model || "",
      choices: [
        {
          index: 0,
          message,
          finish_reason: "stop",
        },
      ],
    };
    if (usage) result.usage = usage;
    return JSON.stringify(result);
  }

  if (format === "anthropic") {
    const contentBlocks: Array<Record<string, unknown>> = [];
    if (hasAnthropicThinking) {
      contentBlocks.push({ type: "thinking", thinking: anthropicThinking });
    }
    if (hasAnthropicText) {
      contentBlocks.push({ type: "text", text: anthropicText });
    }

    const result: Record<string, unknown> = {
      id: id || "",
      type: "message",
      role: "assistant",
      content: contentBlocks,
      model: model || "",
      stop_reason: stopReason || "end_turn",
    };
    if (usage) result.usage = usage;
    return JSON.stringify(result);
  }

  // 无法识别格式，回退为原始拼接
  return "[" + sseChunks.join(",") + "]";
}

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

    // 将 Buffer/Uint8Array 转为 string 后再解析 SSE data 行
    let str: string | null = null;
    if (typeof chunk === "string") {
      str = chunk;
    } else if (Buffer.isBuffer(chunk)) {
      str = chunk.toString("utf-8");
    } else if (chunk instanceof Uint8Array) {
      str = new TextDecoder("utf-8").decode(chunk);
    }

    if (str) {
      const lines = str.split("\n");
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

      responseBodyStr = assembleStreamResponse(sseChunks);
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