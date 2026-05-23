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

/**
 * Handler for provider-specific request transformation.
 *
 * Each provider type (mimo, deepseek, openai, anthropic) implements this interface
 * to handle protocol-specific URL construction and request body adaptation.
 */
export interface ProviderHandler {
  /** Provider type identifier (e.g., "mimo", "deepseek", "openai", "anthropic") */
  readonly type: string;

  /**
   * Get OpenAI-compatible endpoint URL.
   * @param baseUrl - Provider base URL
   * @returns Full URL for OpenAI chat completions, or null if not supported
   */
  getOpenAIUrl(baseUrl: string): string | null;

  /**
   * Get Anthropic-compatible endpoint URL.
   * @param baseUrl - Provider base URL
   * @returns Full URL for Anthropic messages, or null if not supported
   */
  getAnthropicUrl(baseUrl: string): string | null;

  /**
   * Get default base URL for OpenAI-compatible endpoints.
   * @returns Default base URL, or null if not applicable
   */
  getDefaultBaseUrl(): string | null;

  /**
   * Get default base URL for Anthropic-compatible endpoints.
   * @returns Default base URL, or null if not applicable
   */
  getDefaultAnthropicUrl(): string | null;

  /**
   * Transform request body for upstream provider.
   *
   * Performs structural adaptation (field renaming, format restructuring).
   * Does NOT inject field values - all provider-specific defaults come from YAML config.
   *
   * @param body - Request body with defaults applied
   * @param model - Model configuration
   * @param originalClientBody - Original client request body (before defaults)
   * @param providerConfig - Provider configuration
   */
  transformRequest(
    body: Record<string, unknown>,
    model: ModelConfig,
    originalClientBody: Record<string, unknown>,
    providerConfig: ProviderConfig,
  ): void;
}

/**
 * Provider configuration loaded from YAML.
 *
 * Contains all settings needed to connect to an upstream provider,
 * including authentication, endpoints, and model definitions.
 */
export interface ProviderConfig {
  /** Schema version (currently 1) */
  version: number;

  /** Handler type: "mimo", "deepseek", "openai", "anthropic" */
  type: string;

  /** Provider name (derived from YAML filename) */
  name: string;

  /** API key for upstream authentication */
  api_key: string;

  /** Base URL for OpenAI-compatible endpoints */
  base_url: string;

  /** Base URL for Anthropic-compatible endpoints (null if not applicable) */
  anthropic_url: string | null;

  /** HTTP header name for authentication (e.g., "Authorization", "api-key") */
  auth_header: string;

  /** Prefix for API key value (e.g., "Bearer ") */
  auth_prefix: string;

  /** Upstream request timeout in milliseconds */
  timeout: number;

  /** Route prefix for this provider's endpoints */
  endpoint: string;

  /** Model configurations */
  models: ModelConfig[];

  /** Provider-level capability metadata */
  capabilities: Record<string, unknown>;

  /** Default web_search tool configuration */
  web_search: Record<string, unknown> | null;
}

/**
 * Model configuration from YAML.
 *
 * Defines a virtual model ID visible to clients and its mapping
 * to an upstream model ID with optional defaults and capabilities.
 */
export interface ModelConfig {
  /** Client-facing virtual model ID (unique within endpoint) */
  id: string;

  /** Real model ID sent to upstream provider */
  upstream: string;

  /** Maximum context length in tokens */
  context_length: number;

  /** Maximum output tokens */
  max_output_tokens: number;

  /** Human-readable description (auto-generated from id if omitted) */
  description?: string;

  /** Unix timestamp for /v1/models (defaults to config load time) */
  created?: number;

  /** Default values applied when client omits keys (uses post-transform key names) */
  default?: Record<string, unknown>;

  /** Model-level capability overrides (merged with provider capabilities) */
  capabilities?: Record<string, unknown>;

  /** Supported input/output modalities */
  modalities?: {
    input: string[];
    output: string[];
  };

  /** Per-model pricing (flat or tiered). If omitted, cost calculation defaults to 0 (no charge). */
  pricing?: FlatPricing | TieredPricing;
}

/**
 * Result of model lookup in the registry.
 *
 * Contains everything needed to process a request: the handler,
 * provider config, and model-specific config.
 */
export interface ResolvedModel {
  /** Provider handler for request transformation */
  handler: ProviderHandler;

  /** Provider configuration */
  providerConfig: ProviderConfig;

  /** Model-specific configuration */
  modelConfig: ModelConfig;
}
