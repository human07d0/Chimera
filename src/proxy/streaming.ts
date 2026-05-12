import { Response as ExpressResponse } from "express";
import { logger } from "../utils/logger";

export interface PipeSSEOptions {
  onChunk?: (line: string) => string | null;
  skipEmptyLines?: boolean;
  sendErrorChunk?: boolean;
}

export async function pipeSSEStream(
  upstreamResponse: globalThis.Response,
  clientRes: ExpressResponse,
  virtualModelId: string,
  options?: PipeSSEOptions
): Promise<{ inputTokens: number; outputTokens: number; cacheHit: boolean }> {
  const skipEmptyLines = options?.skipEmptyLines !== false;
  const sendErrorChunk = options?.sendErrorChunk !== false;
  const onChunk = options?.onChunk;

  clientRes.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  clientRes.setHeader("Cache-Control", "no-cache, no-transform");
  clientRes.setHeader("Connection", "keep-alive");
  clientRes.setHeader("X-Accel-Buffering", "no");
  clientRes.flushHeaders();

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheHit = false;

  const body = upstreamResponse.body;
  if (!body) {
    logger.warn("Upstream SSE response has no body");
    clientRes.write("data: [DONE]\n\n");
    clientRes.end();
    return { inputTokens, outputTokens, cacheHit };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  let cancelled = false;
  const onClientClose = () => {
    cancelled = true;
    reader.cancel().catch((err) => {
      logger.debug("Failed to cancel stream reader (client disconnected)", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };
  clientRes.on("close", onClientClose);

  try {
    while (!cancelled) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trimEnd();

        if (skipEmptyLines && trimmed === "") {
          continue;
        }

        if (onChunk) {
          const result = onChunk(trimmed);
          if (result === null) continue;
          clientRes.write(`${result}\n`);
          continue;
        }

        if (!trimmed.startsWith("data:")) {
          clientRes.write(`${trimmed}\n`);
          continue;
        }

        const dataContent = trimmed.slice("data:".length).trimStart();

        if (dataContent === "[DONE]") {
          clientRes.write("data: [DONE]\n\n");
          continue;
        }

        try {
          const parsed = JSON.parse(dataContent) as Record<string, unknown>;
          parsed["model"] = virtualModelId;

          const usage = parsed["usage"];
          if (usage && typeof usage === "object") {
            const usageObj = usage as Record<string, unknown>;
            inputTokens =
              (usageObj["prompt_tokens"] as number) ||
              (usageObj["input_tokens"] as number) ||
              inputTokens;
            outputTokens =
              (usageObj["completion_tokens"] as number) ||
              (usageObj["output_tokens"] as number) ||
              outputTokens;
            cacheHit =
              (usageObj["cache_hit"] as boolean) ||
              cacheHit;
          }

          clientRes.write(`data: ${JSON.stringify(parsed)}\n\n`);
        } catch {
          logger.warn("Failed to parse SSE chunk JSON, forwarding as-is", {
            chunk: dataContent.slice(0, 200),
          });
          clientRes.write(`data: ${dataContent}\n\n`);
        }
      }
    }

    if (buffer.trim()) {
      logger.debug("SSE stream ended with non-empty buffer remainder", {
        remainder: buffer.slice(0, 200),
      });
    }
  } catch (err) {
    if (cancelled) {
      logger.debug("Stream cancelled (client disconnected)");
    } else {
      logger.error("Error while reading upstream SSE stream", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (sendErrorChunk) {
        const errorChunk = {
          error: {
            message: "Upstream stream interrupted",
            type: "upstream_error",
            code: "stream_error",
          },
        };
        clientRes.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
        clientRes.write("data: [DONE]\n\n");
      }
    }
  } finally {
    clientRes.off("close", onClientClose);
    reader.releaseLock();
    clientRes.end();
  }

  return { inputTokens, outputTokens, cacheHit };
}

