import type { ProviderHandler, ModelConfig, ProviderConfig } from "../types";

export const chimeraHandler: ProviderHandler = {
  type: "chimera",

  getOpenAIUrl(baseUrl: string): string | null {
    return `${baseUrl}/v1/chat/completions`;
  },

  getAnthropicUrl(baseUrl: string): string | null {
    return `${baseUrl}/anthropic/v1/messages`;
  },

  getDefaultBaseUrl(): string | null {
    return null;
  },

  getDefaultAnthropicUrl(): string | null {
    return null;
  },

  transformRequest(): void {
    // No-op: upstream chimera handles its own transforms
  },
};
