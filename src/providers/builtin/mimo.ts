import type { ProviderHandler, ModelConfig, ProviderConfig } from "../types";
import { logger } from "../../utils/logger";

export const mimoHandler: ProviderHandler = {
  type: "mimo",

  getOpenAIUrl(baseUrl: string): string | null {
    return `${baseUrl}/v1/chat/completions`;
  },

  getAnthropicUrl(baseUrl: string): string | null {
    return `${baseUrl}/v1/messages`;
  },

  getDefaultBaseUrl(): string | null {
    return "https://api.xiaomimimo.com";
  },

  getDefaultAnthropicUrl(): string | null {
    return "https://api.xiaomimimo.com/anthropic";
  },

  transformRequest(
    body: Record<string, unknown>,
    model: ModelConfig,
    originalClientBody: Record<string, unknown>,
    providerConfig: ProviderConfig,
  ): Record<string, unknown> {
    if ("max_tokens" in body) {
      if (!("max_completion_tokens" in originalClientBody)) {
        body["max_completion_tokens"] = body["max_tokens"];
      }
      delete body["max_tokens"];
    }

    const webSearchValue = body["web_search"];
    if (webSearchValue !== undefined && webSearchValue !== false) {
      delete body["web_search"];
      const webSearchTool = buildWebSearchTool(webSearchValue, providerConfig);
      const existingTools = Array.isArray(body["tools"]) ? [...body["tools"] as unknown[]] : [];
      body["tools"] = [webSearchTool, ...existingTools];
    }

    if (Array.isArray(body["tools"])) {
      const tools = body["tools"] as Record<string, unknown>[];
      const filtered = tools.filter((t) => t.type === "function" || t.type === "web_search");
      if (filtered.length > 0) {
        body["tools"] = filtered;
      } else {
        delete body["tools"];
        delete body["tool_choice"];
      }
    }

    if (!body["tools"]) {
      delete body["tool_choice"];
    }

    logger.debug("MiMo transformRequest", {
      model: body["model"],
      hasThinking: !!body["thinking"],
      hasWebSearch: webSearchValue !== undefined && webSearchValue !== false,
      toolCount: Array.isArray(body["tools"]) ? (body["tools"] as unknown[]).length : 0,
    });

    return body;
  },
};

function buildWebSearchTool(
  value: unknown,
  providerConfig: ProviderConfig,
): Record<string, unknown> {
  const providerDefaults = providerConfig.web_search ?? {};

  if (value === true) {
    return { type: "web_search", ...providerDefaults };
  }
  if (typeof value === "object" && value !== null) {
    return { type: "web_search", ...providerDefaults, ...(value as Record<string, unknown>) };
  }
  return { type: "web_search", ...providerDefaults };
}
