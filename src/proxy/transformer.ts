import { ModelFeatures, buildWebSearchTool } from "../models/presets";
import { logger } from "../utils/logger";

export interface ChatCompletionRequest {
  model: string;
  messages: unknown[];
  stream?: boolean | null;
  temperature?: number | null;
  top_p?: number | null;
  max_completion_tokens?: number | null;
  /** 兼容旧版 OpenAI 客户端 */
  max_tokens?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  stop?: string | string[] | null;
  tools?: ToolDefinition[] | null;
  tool_choice?: unknown;
  response_format?: { type: string } | null;
  [key: string]: unknown;
}

interface ToolDefinition {
  type: string;
  [key: string]: unknown;
}

export function transformRequest(
  clientBody: ChatCompletionRequest,
  features: ModelFeatures,
  upstreamModel: string
): Record<string, unknown> {
  const upstream: Record<string, unknown> = { ...clientBody };

  upstream["model"] = upstreamModel;

  // 3. max_tokens 兼容：旧客户端用 max_tokens，小米用 max_completion_tokens
  if (!clientBody.max_completion_tokens && clientBody.max_tokens) {
    upstream["max_completion_tokens"] = clientBody.max_tokens;
  }
  // 不再向上游传 max_tokens（小米不认识这个字段，避免歧义）
  delete upstream["max_tokens"];

  upstream["thinking"] = { type: features.thinking ? "enabled" : "disabled" };

  // 5. response_format：json 模式时强制设置，否则不覆盖客户端设置
  if (features.json) {
    upstream["response_format"] = { type: "json_object" };
  }
  // 如果 features.json=false 但客户端自己传了 response_format，保留客户端的值（已在 ...clientBody 中）

  const clientTools = normalizeTools(clientBody.tools);
  if (features.search) {
    upstream["tools"] = [buildWebSearchTool(), ...clientTools];
  } else if (clientTools.length > 0) {
    upstream["tools"] = clientTools;
  } else {
    // 没有任何工具，删除 tools 字段（避免传空数组给上游）
    delete upstream["tools"];
  }

  // tool_choice 只有在有 tools 时才有意义，透传即可
  if (!upstream["tools"]) {
    delete upstream["tool_choice"];
  }

  logger.debug("Transformed upstream request", {
    model: upstream["model"],
    thinking: upstream["thinking"],
    response_format: upstream["response_format"],
    toolCount: Array.isArray(upstream["tools"]) ? (upstream["tools"] as unknown[]).length : 0,
    hasSearch: features.search,
  });

  return upstream;
}

function normalizeTools(tools: ToolDefinition[] | null | undefined): ToolDefinition[] {
  if (!Array.isArray(tools)) return [];
  // 只保留 function 类型（web_search 由我们自己注入）
  return tools.filter((t) => t.type === "function");
}

export function transformResponse(
  responseBody: Record<string, unknown>,
  virtualModelId: string
): Record<string, unknown> {
  return { ...responseBody, model: virtualModelId };
}

