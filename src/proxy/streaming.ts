import { Response as ExpressResponse } from "express";
import { logger } from "../utils/logger";

/**
 * 将上游的 SSE 响应流转发给客户端，同时对每个 data chunk 进行转换。
 *
 * 小米的 SSE 格式（与 OpenAI 兼容）：
 *   data: { ...json... }\n\n
 *   data: [DONE]\n\n
 */
export async function pipeSSEStream(
  upstreamResponse: globalThis.Response,
  clientRes: ExpressResponse,
  virtualModelId: string
): Promise<void> {
  // 设置 SSE 响应头
  clientRes.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  clientRes.setHeader("Cache-Control", "no-cache, no-transform");
  clientRes.setHeader("Connection", "keep-alive");
  clientRes.setHeader("X-Accel-Buffering", "no"); // 禁用 nginx 缓冲
  clientRes.flushHeaders();

  const body = upstreamResponse.body;
  if (!body) {
    logger.warn("Upstream SSE response has no body");
    clientRes.write("data: [DONE]\n\n");
    clientRes.end();
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  // 用于跨 chunk 拼接不完整行
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按换行符分割，处理每一行
      const lines = buffer.split("\n");
      // 最后一个元素可能是不完整的行，留到下次处理
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trimEnd();

        if (trimmed === "") {
          // 空行：SSE 事件分隔符，直接写入
          clientRes.write("\n");
          continue;
        }

        if (!trimmed.startsWith("data:")) {
          // 其他 SSE 字段（如 event:, id:, retry:）原样转发
          clientRes.write(`${trimmed}\n`);
          continue;
        }

        const dataContent = trimmed.slice("data:".length).trimStart();

        if (dataContent === "[DONE]") {
          clientRes.write("data: [DONE]\n\n");
          continue;
        }

        // 尝试解析 JSON，替换 model 字段后重新序列化
        try {
          const parsed = JSON.parse(dataContent) as Record<string, unknown>;
          parsed["model"] = virtualModelId;
          clientRes.write(`data: ${JSON.stringify(parsed)}\n\n`);
        } catch {
          // JSON 解析失败：原样转发，避免数据丢失
          logger.warn("Failed to parse SSE chunk JSON, forwarding as-is", {
            chunk: dataContent.slice(0, 200),
          });
          clientRes.write(`data: ${dataContent}\n\n`);
        }
      }
    }

    // 处理 buffer 中剩余的内容（正常情况下应为空）
    if (buffer.trim()) {
      logger.debug("SSE stream ended with non-empty buffer remainder", {
        remainder: buffer.slice(0, 200),
      });
    }
  } catch (err) {
    logger.error("Error while reading upstream SSE stream", {
      error: err instanceof Error ? err.message : String(err),
    });
    // 流中途报错时，写一个 error chunk 通知客户端（符合 OpenAI 错误格式）
    const errorChunk = {
      error: {
        message: "Upstream stream interrupted",
        type: "upstream_error",
        code: "stream_error",
      },
    };
    clientRes.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
    clientRes.write("data: [DONE]\n\n");
  } finally {
    reader.releaseLock();
    clientRes.end();
  }
}
