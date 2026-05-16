import type { ProviderHandler, ModelConfig, ProviderConfig } from "../types";
import { logger } from "../../utils/logger";

export const kimiHandler: ProviderHandler = {
  type: "kimi",

  getOpenAIUrl(baseUrl: string): string | null {
    return `${baseUrl}/v1/chat/completions`;
  },

  getAnthropicUrl(_baseUrl: string): string | null {
    return null;
  },

  getDefaultBaseUrl(): string | null {
    return "https://api.moonshot.cn";
  },

  getDefaultAnthropicUrl(): string | null {
    return null;
  },

  transformRequest(
    body: Record<string, unknown>,
    _model: ModelConfig,
    originalClientBody: Record<string, unknown>,
    _providerConfig: ProviderConfig,
  ): void {
    if ("max_tokens" in body) {
      if (!("max_completion_tokens" in originalClientBody)) {
        body["max_completion_tokens"] = body["max_tokens"];
      }
      delete body["max_tokens"];
    }

    delete body["parallel_tool_calls"];

    if (Array.isArray(body["tools"])) {
      const tools = body["tools"] as Record<string, unknown>[];
      const filtered = tools.filter((t) => t.type === "function");
      if (filtered.length < tools.length) {
        logger.warn("Non-standard tools filtered out", {
          model: body["model"],
          dropped: tools.length - filtered.length,
        });
      }
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

    logger.debug("Kimi transformRequest", { model: body["model"] });
  },
};
