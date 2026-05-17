import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { logger } from "../utils/logger";
import { debugStore } from "./store";
import { DebugMediaItem } from "./types";

export function assembleStreamResponse(sseChunks: Array<string | Record<string, unknown>>): string {
  let format: "openai" | "anthropic" | null = null;
  let id: string | undefined;
  let model: string | undefined;
  let usage: Record<string, unknown> | undefined;

  let content = "";
  let reasoningContent = "";
  let hasContent = false;
  let hasReasoning = false;
  let created: number | undefined;
  let systemFingerprint: string | undefined;
  let finishReason: string | undefined;
  let refusal: string | undefined;
  let logprobs: unknown;
  let promptTokensDetails: unknown;
  let completionTokensDetails: unknown;

  const toolCallsMap = new Map<number, {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>();

  const anthropicBlocks = new Map<number, Record<string, unknown>>();
  let stopReason: string | undefined;
  let stopSequence: string | undefined;
  const contentSignatures = new Map<number, string>();
  let cacheCreationTokens: number | undefined;
  let cacheReadTokens: number | undefined;
  let typeFromMessageStart: string | undefined;
  let roleFromMessageStart: string | undefined;

  for (const chunk of sseChunks) {
    let parsed: Record<string, unknown>;
    try {
      parsed = typeof chunk === "string" ? JSON.parse(chunk) : chunk;
    } catch {
      logger.debug("debug: skipping unparseable SSE chunk", { chunk: typeof chunk === "string" ? chunk.slice(0, 120) : "[object]" });
      continue;
    }

    if (!format) {
      if (parsed.choices !== undefined) {
        format = "openai";
      } else if (parsed.type !== undefined) {
        format = "anthropic";
      }
    }

    if (format === "openai") {
      if (parsed.id && !id) id = parsed.id as string;
      if (parsed.model && !model) model = parsed.model as string;
      if (parsed.created && !created) created = parsed.created as number;
      if (parsed.system_fingerprint && !systemFingerprint) systemFingerprint = parsed.system_fingerprint as string;
      if (parsed.usage) {
        const u = parsed.usage as Record<string, unknown>;
        usage = u;
        if (u.prompt_tokens_details !== undefined) promptTokensDetails = u.prompt_tokens_details;
        if (u.completion_tokens_details !== undefined) completionTokensDetails = u.completion_tokens_details;
      }

      const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
      if (choices?.[0]) {
        if (choices[0].finish_reason) finishReason = choices[0].finish_reason as string;
        if (choices[0].logprobs !== undefined) logprobs = choices[0].logprobs;
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
          if (delta.refusal !== undefined) refusal = delta.refusal as string;
          const deltaToolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(deltaToolCalls)) {
            for (const tc of deltaToolCalls) {
              const idx = tc.index as number;
              let acc = toolCallsMap.get(idx);
              if (!acc) {
                acc = { id: "", type: "function", function: { name: "", arguments: "" } };
                toolCallsMap.set(idx, acc);
              }
              if (tc.id) acc.id = tc.id as string;
              if (tc.type) acc.type = tc.type as "function";
              const fn = tc.function as Record<string, unknown> | undefined;
              if (fn) {
                if (fn.name) acc.function.name = fn.name as string;
                if (typeof fn.arguments === "string") acc.function.arguments += fn.arguments;
              }
            }
          }
        }
      }
    } else if (format === "anthropic") {
      const type = parsed.type as string;

      if (type === "message_start") {
        const msg = parsed.message as Record<string, unknown> | undefined;
        if (msg) {
          if (msg.id && !id) id = msg.id as string;
          if (msg.model && !model) model = msg.model as string;
          if (msg.type && !typeFromMessageStart) typeFromMessageStart = msg.type as string;
          if (msg.role && !roleFromMessageStart) roleFromMessageStart = msg.role as string;
        }
      }

      if (type === "content_block_start") {
        const contentBlock = parsed.content_block as Record<string, unknown> | undefined;
        const cbIndex = parsed.index as number;
        if (contentBlock) {
          if (contentBlock.type === "tool_use") {
            anthropicBlocks.set(cbIndex, {
              type: "tool_use",
              id: contentBlock.id || "",
              name: contentBlock.name || "",
              input: "",
            });
          } else if (contentBlock.type === "thinking") {
            anthropicBlocks.set(cbIndex, {
              type: "thinking",
              thinking: (contentBlock.thinking as string) || "",
            });
            if (contentBlock.signature) contentSignatures.set(cbIndex, contentBlock.signature as string);
          } else if (contentBlock.type === "text") {
            anthropicBlocks.set(cbIndex, {
              type: "text",
              text: (contentBlock.text as string) || "",
            });
          } else if (contentBlock.type === "image") {
            anthropicBlocks.set(cbIndex, {
              type: "image",
              source: contentBlock.source || {},
            });
          }
        }
      }

      if (type === "content_block_delta") {
        const delta = parsed.delta as Record<string, unknown> | undefined;
        const cbIndex = parsed.index as number;
        if (delta) {
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            const block = anthropicBlocks.get(cbIndex);
            if (block) {
              block.text = ((block.text as string) || "") + delta.text;
            } else {
              anthropicBlocks.set(cbIndex, { type: "text", text: delta.text });
            }
          }
          if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
            const block = anthropicBlocks.get(cbIndex);
            if (block) {
              block.thinking = ((block.thinking as string) || "") + delta.thinking;
            } else {
              anthropicBlocks.set(cbIndex, { type: "thinking", thinking: delta.thinking });
            }
          }
          if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
            const block = anthropicBlocks.get(cbIndex);
            if (block) {
              block.input = ((block.input as string) || "") + delta.partial_json;
            } else {
              anthropicBlocks.set(cbIndex, { type: "tool_use", input: delta.partial_json });
            }
          }
          if (delta.type === "signature_delta" && typeof delta.signature === "string") {
            const existing = contentSignatures.get(cbIndex) || "";
            contentSignatures.set(cbIndex, existing + delta.signature);
          }
        }
      }

      if (type === "message_delta") {
        const delta = parsed.delta as Record<string, unknown> | undefined;
        if (delta?.stop_reason) stopReason = delta.stop_reason as string;
        if (delta?.stop_sequence !== undefined) stopSequence = delta.stop_sequence as string;
        if (parsed.usage) {
          const u = parsed.usage as Record<string, unknown>;
          usage = u;
          if (u.cache_creation_input_tokens !== undefined) cacheCreationTokens = u.cache_creation_input_tokens as number;
          if (u.cache_read_input_tokens !== undefined) cacheReadTokens = u.cache_read_input_tokens as number;
        }
      }
    }
  }

  if (format === "openai") {
    const message: Record<string, unknown> = { role: "assistant" };
    if (hasContent) message.content = content;
    if (hasReasoning) message.reasoning_content = reasoningContent;
    if (refusal) message.refusal = refusal;
    if (toolCallsMap.size > 0) {
      message.tool_calls = Array.from(toolCallsMap.entries()).map(([idx, tc]) => ({
        index: idx,
        id: tc.id,
        type: tc.type,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }

    if (usage) {
      if (promptTokensDetails !== undefined) usage.prompt_tokens_details = promptTokensDetails;
      if (completionTokensDetails !== undefined) usage.completion_tokens_details = completionTokensDetails;
    }

    const result: Record<string, unknown> = {
      id: id || "",
      object: "chat.completion",
      created: created ?? 0,
      model: model || "",
      system_fingerprint: systemFingerprint ?? null,
      choices: [
        {
          index: 0,
          message,
          finish_reason: finishReason || "stop",
          logprobs: logprobs ?? null,
        },
      ],
    };
    if (usage) result.usage = usage;
    return JSON.stringify(result);
  }

  if (format === "anthropic") {
    const sortedIndices = Array.from(anthropicBlocks.keys()).sort((a, b) => a - b);
    const contentBlocks = sortedIndices.map((i) => {
      const block = { ...anthropicBlocks.get(i)! };
      if (block.type === "tool_use" && typeof block.input === "string") {
        try {
          block.input = JSON.parse(block.input as string);
        } catch (err) {
          logger.warn("debug: failed to parse tool_use input JSON, keeping raw string", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (block.type === "thinking" && contentSignatures.has(i)) {
        block.signature = contentSignatures.get(i);
      }
      return block;
    });

    if (usage) {
      if (cacheCreationTokens !== undefined) usage.cache_creation_input_tokens = cacheCreationTokens;
      if (cacheReadTokens !== undefined) usage.cache_read_input_tokens = cacheReadTokens;
    }

    const result: Record<string, unknown> = {
      id: id || "",
      type: typeFromMessageStart || "message",
      role: roleFromMessageStart || "assistant",
      content: contentBlocks,
      model: model || "",
      stop_reason: stopReason || "end_turn",
      stop_sequence: stopSequence ?? null,
    };
    if (usage) result.usage = usage;
    return JSON.stringify(result);
  }

  return "[" + sseChunks.map(c => typeof c === "string" ? c : JSON.stringify(c)).join(",") + "]";
}

const DATA_URI_RE = /^data:([a-z]+\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\r\n]+)$/;

function inferMediaKind(mediaType: string): DebugMediaItem["kind"] {
  const lower = mediaType.toLowerCase();
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("audio/")) return "audio";
  if (lower.startsWith("video/")) return "video";
  return "unknown";
}

function jsonPath(prefix: string, key: string | number): string {
  if (typeof key === "number") return `${prefix}[${key}]`;
  return prefix ? `${prefix}.${key}` : key;
}

export function extractAndSummarizeMedia(
  jsonStr: string,
  location: "request" | "response",
  options: { maxMediaBytes: number }
): { body: string; media: DebugMediaItem[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.warn("debug: body is not valid JSON, skipping media extraction", {
      location,
      preview: jsonStr.slice(0, 120),
    });
    return { body: jsonStr, media: [] };
  }

  const media: DebugMediaItem[] = [];
  let mediaIndex = 0;

  function walk(value: unknown, parent: Record<string, unknown> | unknown[], key: string | number, currentPath: string): void {
    if (value === null || value === undefined) return;

    if (typeof value === "string") {
      const match = value.match(DATA_URI_RE);
      if (match) {
        const mediaType = match[1];
        const data = match[2];
        const byteLength = Buffer.byteLength(Buffer.from(data, "base64"));
        const kind = inferMediaKind(mediaType);
        const id = `media-${location}-${mediaIndex++}`;

        const item: DebugMediaItem = {
          id,
          location,
          path: currentPath,
          kind,
          media_type: mediaType,
          encoding: "base64",
          byte_length: byteLength,
          data_base64: byteLength <= options.maxMediaBytes ? data : "",
        };

        media.push(item);

        const placeholder = `[_debug_media id=${id} type=${mediaType} bytes=${byteLength}]`;
        if (Array.isArray(parent)) {
          parent[key as number] = placeholder;
        } else {
          parent[key] = placeholder;
        }
      }
      return;
    }

    if (typeof value !== "object") return;

    if (!Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if (obj.type === "base64" && typeof obj.media_type === "string" && typeof obj.data === "string") {
        const mediaType = obj.media_type;
        const data = obj.data;
        const byteLength = Buffer.byteLength(Buffer.from(data, "base64"));
        const kind = inferMediaKind(mediaType);
        const id = `media-${location}-${mediaIndex++}`;

        const item: DebugMediaItem = {
          id,
          location,
          path: currentPath,
          kind,
          media_type: mediaType,
          encoding: "base64",
          byte_length: byteLength,
          data_base64: byteLength <= options.maxMediaBytes ? data : "",
        };

        media.push(item);

        const placeholder = `[_debug_media id=${id} type=${mediaType} bytes=${byteLength}]`;
        obj.data = placeholder;
        return;
      }
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], value, i, jsonPath(currentPath, i));
      }
    } else {
      const obj = value as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        walk(obj[k], obj, k, jsonPath(currentPath, k));
      }
    }
  }

  walk(parsed, {} as Record<string, unknown>, "__root__", "");
  return { body: JSON.stringify(parsed), media };
}

const MONITORED_PATHS = new Set(["/chat/completions", "/messages"]);

export function debugMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!MONITORED_PATHS.has(req.path)) {
    next();
    return;
  }

  const tsStart = Date.now();
  const modelRequestedEarly = (req.body?.model as string) || "unknown";
  const method = req.method;
  const reqPath = req.originalUrl || req.path;
  const maxBodySize = config.debug.maxBodySize;
  const maxMediaBytes = config.debug.maxMediaBytes;

  let mediaItems: DebugMediaItem[] = [];

  let requestBodyStr: string;
  try {
    requestBodyStr = JSON.stringify(req.body ?? {});
  } catch (err) {
    logger.warn("debug: failed to serialize request body", {
      error: err instanceof Error ? err.message : String(err),
    });
    requestBodyStr = "{}";
  }

  const reqResult = extractAndSummarizeMedia(requestBodyStr, "request", { maxMediaBytes });
  requestBodyStr = reqResult.body;
  mediaItems = mediaItems.concat(reqResult.media);

  if (requestBodyStr.length > maxBodySize) {
    requestBodyStr = requestBodyStr.slice(0, maxBodySize) + "...[truncated]";
  }

  const originalJson = res.json.bind(res);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  let stream = false;
  let responseBodyStr = "";
  let errorType: string | null = null;
  let errorBodyStr: string | null = null;
  const sseChunks: Array<string | Record<string, unknown>> = [];
  let sseBuffer = "";

  res.json = function (body: any): Response {
    try {
      responseBodyStr = JSON.stringify(body);
    } catch (err) {
      logger.warn("debug: failed to serialize response body", {
        error: err instanceof Error ? err.message : String(err),
      });
      responseBodyStr = "[unserializable]";
    }

    const respResult = extractAndSummarizeMedia(responseBodyStr, "response", { maxMediaBytes });
    responseBodyStr = respResult.body;
    mediaItems = mediaItems.concat(respResult.media);

    if (responseBodyStr.length > maxBodySize) {
      responseBodyStr = responseBodyStr.slice(0, maxBodySize) + "...[truncated]";
    }

    if (body?.error && typeof body.error === "object") {
      errorType = (body.error.type as string) || `http_${res.statusCode}`;
      try {
        errorBodyStr = JSON.stringify(body.error);
      } catch (err) {
        logger.warn("debug: failed to serialize error body", {
          error: err instanceof Error ? err.message : String(err),
        });
        errorBodyStr = null;
      }
    }

    return originalJson(body);
  };

  res.write = function (chunk: any, encoding?: any, callback?: any): boolean {
    stream = true;

    let str: string | null = null;
    if (typeof chunk === "string") {
      str = chunk;
    } else if (Buffer.isBuffer(chunk)) {
      str = chunk.toString("utf-8");
    } else if (chunk instanceof Uint8Array) {
      str = new TextDecoder("utf-8").decode(chunk);
    }

    if (str) {
      sseBuffer += str;
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataContent = line.slice("data: ".length);
        if (!dataContent || dataContent === "[DONE]") continue;
        const shared = (res as any)?.locals?._sseChunk;
        sseChunks.push(shared?.parsed ?? dataContent);
      }
    }

    return originalWrite(chunk, encoding, callback);
  };

  res.end = function (...args: any[]): Response {
    const tsEnd = Date.now();

    if (stream) {
      for (const chunk of sseChunks) {
        try {
          const parsed: Record<string, unknown> = typeof chunk === "string" ? JSON.parse(chunk) : chunk;
          if (parsed["error"] && typeof parsed["error"] === "object") {
            const errObj = parsed["error"] as Record<string, unknown>;
            errorType = (errObj["type"] as string) || "upstream_error";
            errorBodyStr = JSON.stringify(errObj);
            break;
          }
        } catch {
          logger.debug("debug: skipping unparseable SSE chunk during error scan", {
            chunk: typeof chunk === "string" ? chunk.slice(0, 120) : "[object]",
          });
        }
      }

      responseBodyStr = assembleStreamResponse(sseChunks);

      const respResult = extractAndSummarizeMedia(responseBodyStr, "response", { maxMediaBytes });
      responseBodyStr = respResult.body;
      mediaItems = mediaItems.concat(respResult.media);

      if (responseBodyStr.length > maxBodySize) {
        responseBodyStr = responseBodyStr.slice(0, maxBodySize) + "...[truncated]";
      }
    }

    if (!stream && res.statusCode >= 400 && !errorType) {
      errorType = `http_${res.statusCode}`;
    }

    const requestId =
      (res.locals.requestId as string | undefined) ||
      req.headers["x-request-id"]?.toString() ||
      `debug-${tsStart.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const upstreamModel =
      (res.locals.upstreamModel as string | undefined) || "";

    const virtualModelId =
      (res.locals.virtualModelId as string | undefined) || modelRequestedEarly;

    const providerName =
      (res.locals.providerName as string | undefined) || "unknown";

    debugStore.append({
      request_id: requestId,
      ts_start: tsStart,
      ts_end: tsEnd,
      path: reqPath,
      method,
      status_code: res.statusCode,
      model_requested: virtualModelId,
      model_upstream: upstreamModel,
      provider_name: providerName,
      stream,
      request_body: requestBodyStr,
      response_body: responseBodyStr,
      error_type: errorType,
      error_body: errorBodyStr,
      media: mediaItems.length > 0 ? mediaItems : undefined,
    });

    return originalEnd(...args);
  };

  next();
}