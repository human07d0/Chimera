import type { ProviderHandler, ModelConfig, ProviderConfig } from "../types";

export const openaiHandler: ProviderHandler = {
  type: "openai",

  getOpenAIUrl(baseUrl: string): string | null {
    return `${baseUrl}/v1/chat/completions`;
  },

  getAnthropicUrl(_baseUrl: string): string | null {
    return null;
  },

  getDefaultBaseUrl(): string | null {
    return null;
  },

  getDefaultAnthropicUrl(): string | null {
    return null;
  },

  transformRequest(
    body: Record<string, unknown>,
    _model: ModelConfig,
    _originalClientBody: Record<string, unknown>,
    _providerConfig: ProviderConfig,
  ): Record<string, unknown> {
    return body;
  },
};
