import type { ProviderHandler, ModelConfig, ProviderConfig } from "../types";

export const anthropicHandler: ProviderHandler = {
  type: "anthropic",

  getOpenAIUrl(_baseUrl: string): string | null {
    return null;
  },

  getAnthropicUrl(baseUrl: string): string | null {
    return `${baseUrl}/v1/messages`;
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
