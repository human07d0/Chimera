import type { ProviderHandler, ModelConfig, ProviderConfig } from "../types";
import { logger } from "../../utils/logger";

export const aliyunHandler: ProviderHandler = {
  type: "aliyun",

  getOpenAIUrl(baseUrl: string): string | null {
    return `${baseUrl}/v1/chat/completions`;
  },

  getAnthropicUrl(baseUrl: string): string | null {
    return `${baseUrl}/v1/messages`;
  },

  getDefaultBaseUrl(): string | null {
    return "https://dashscope.aliyuncs.com/compatible-mode";
  },

  getDefaultAnthropicUrl(): string | null {
    return "https://dashscope.aliyuncs.com/apps/anthropic";
  },

  transformRequest(
    body: Record<string, unknown>,
    _model: ModelConfig,
    _originalClientBody: Record<string, unknown>,
    _providerConfig: ProviderConfig,
  ): void {
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

    logger.debug("Aliyun transformRequest", {
      model: body["model"],
    });
  },
};
