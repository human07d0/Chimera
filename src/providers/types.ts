export interface FlatPricing {
  input: number;
  cached_input?: number;
  output: number;
}

export interface PriceTier {
  max_tokens: number;
  input: number;
  cached_input?: number;
  output: number;
}

export interface TieredPricing {
  tiers: PriceTier[];
}

export interface ProviderHandler {
  readonly type: string;
  getOpenAIUrl(baseUrl: string): string | null;
  getAnthropicUrl(baseUrl: string): string | null;
  getDefaultBaseUrl(): string | null;
  getDefaultAnthropicUrl(): string | null;
  transformRequest(
    body: Record<string, unknown>,
    model: ModelConfig,
    originalClientBody: Record<string, unknown>,
    providerConfig: ProviderConfig,
  ): void;
}

export interface ProviderConfig {
  version: number;
  type: string;
  name: string;
  api_key: string;
  base_url: string;
  anthropic_url: string | null;
  auth_header: string;
  auth_prefix: string;
  timeout: number;
  endpoint: string;
  models: ModelConfig[];
  capabilities: Record<string, unknown>;
  web_search: Record<string, unknown> | null;
}

export interface ModelConfig {
  id: string;
  upstream: string;
  context_length: number;
  max_output_tokens: number;
  description?: string;
  created?: number;
  default?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  modalities?: {
    input: string[];
    output: string[];
  };
  pricing?: FlatPricing | TieredPricing;
}

export interface ResolvedModel {
  handler: ProviderHandler;
  providerConfig: ProviderConfig;
  modelConfig: ModelConfig;
}
