import { Request, Response, NextFunction } from "express";
import { addCallRecord } from "./storage";
import { logger } from "../utils/logger";

// 计算成本
function calculateCost(
  promptTokens: number,
  cachedPromptTokens: number,
  completionTokens: number
): number {
  const paidPromptTokens = Math.max(promptTokens - cachedPromptTokens, 0);

  const cachedCost = (cachedPromptTokens / 1_000_000) * 0.07;
  const promptCost = (paidPromptTokens / 1_000_000) * 0.7;
  const completionCost = (completionTokens / 1_000_000) * 2.1;

  return cachedCost + promptCost + completionCost;
}

// 监控中间件
export function monitorMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const model = req.body?.model || "unknown";

  // 保存原始响应方法
  const originalJson = res.json.bind(res);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res) as (...args: any[]) => Response;

  // 用于存储流式响应的使用信息
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedPromptTokens = 0;
  let isStreaming = false;

  // 拦截响应以提取使用信息（非流式）
  res.json = function (body: any): Response {
    const duration = Date.now() - startTime;
    
    if (body && typeof body === "object") {
      const usage = body.usage;
      if (usage && typeof usage === "object") {
        const usageObj = usage as any;
        promptTokens = usageObj.prompt_tokens || usageObj.input_tokens || 0;
        completionTokens = usageObj.completion_tokens || usageObj.output_tokens || 0;
        const promptDetails = usageObj.prompt_tokens_details || {};
        cachedPromptTokens = promptDetails.cached_tokens || 0;
      }
    }

    const cost = calculateCost(promptTokens, cachedPromptTokens, completionTokens);

    addCallRecord({
      model,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      cachedPromptTokens,
      cost,
      duration,
    });

    logger.info("API call completed", {
      model,
      promptTokens,
      completionTokens,
      cachedPromptTokens,
      cost: cost.toFixed(4),
      duration,
    });

    return originalJson(body);
  };

  // 拦截流式响应
  res.write = function (chunk: any, encoding?: any, callback?: any): boolean {
    isStreaming = true;
    
    // 尝试从流式响应中提取使用信息
    if (typeof chunk === "string") {
      // 检查是否是 SSE 格式
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const dataContent = line.slice("data: ".length);
          if (dataContent && dataContent !== "[DONE]") {
            try {
              const parsed = JSON.parse(dataContent);
              if (parsed && typeof parsed === "object") {
                const usage = (parsed as any).usage;
                if (usage && typeof usage === "object") {
                  const usageObj = usage as any;
                  promptTokens = usageObj.prompt_tokens || usageObj.input_tokens || promptTokens;
                  completionTokens = usageObj.completion_tokens || usageObj.output_tokens || completionTokens;
                  const promptDetails = usageObj.prompt_tokens_details || {};
                  cachedPromptTokens = promptDetails.cached_tokens || cachedPromptTokens;
                }
              }
            } catch {
              // JSON 解析失败，忽略
            }
          }
        }
      }
    }
    
    return originalWrite.call(this, chunk, encoding, callback);
  };

  // 拦截响应结束
  res.end = function (...args: any[]): Response {
    const duration = Date.now() - startTime;
    
    if (isStreaming) {
      const cost = calculateCost(promptTokens, cachedPromptTokens, completionTokens);

      addCallRecord({
        model,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        cachedPromptTokens,
        cost,
        duration,
      });

      logger.info("Streaming API call completed", {
        model,
        promptTokens,
        completionTokens,
        cachedPromptTokens,
        cost: cost.toFixed(4),
        duration,
      });
    }

    return originalEnd(...args);
  };

  next();
}