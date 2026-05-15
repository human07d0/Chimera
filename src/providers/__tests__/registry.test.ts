import { describe, it, expect, beforeEach } from "vitest";
import { ProviderRegistry } from "../registry";
import type { ProviderHandler, ProviderConfig, ModelConfig } from "../types";

const mockHandler: ProviderHandler = {
  type: "test",
  getOpenAIUrl: (baseUrl) => `${baseUrl}/v1/chat/completions`,
  getAnthropicUrl: () => null,
  getDefaultBaseUrl: () => "https://test.example.com",
  getDefaultAnthropicUrl: () => null,
  transformRequest: (_body, _model, _original, _provider) => {},
};

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
    (registry as any).handlers.set("test", mockHandler);
    (registry as any).initialized = true;
  });

  it("lookup returns null for unknown endpoint", () => {
    expect(registry.lookup("model-1", "/unknown")).toBeNull();
  });

  it("lookup returns null for unknown model", () => {
    const provider: ProviderConfig = {
      version: 1,
      type: "test",
      name: "test-provider",
      api_key: "key",
      base_url: "https://test.example.com",
      anthropic_url: null,
      auth_header: "Authorization",
      auth_prefix: "Bearer ",
      timeout: 120000,
      endpoint: "",
      models: [
        {
          id: "model-1",
          upstream: "model-1",
          context_length: 128000,
          max_output_tokens: 16384,
          description: "model-1",
          created: 1700000000,
        },
      ],
      capabilities: {},
      web_search: null,
    };
    (registry as any).providers = [provider];
    (registry as any).buildIndex();

    expect(registry.lookup("unknown-model", "")).toBeNull();
  });

  it("lookup returns resolved model for known model", () => {
    const provider: ProviderConfig = {
      version: 1,
      type: "test",
      name: "test-provider",
      api_key: "key",
      base_url: "https://test.example.com",
      anthropic_url: null,
      auth_header: "Authorization",
      auth_prefix: "Bearer ",
      timeout: 120000,
      endpoint: "",
      models: [
        {
          id: "model-1",
          upstream: "model-1-upstream",
          context_length: 128000,
          max_output_tokens: 16384,
          description: "model-1",
          created: 1700000000,
        },
      ],
      capabilities: {},
      web_search: null,
    };
    (registry as any).providers = [provider];
    (registry as any).buildIndex();

    const resolved = registry.lookup("model-1", "");
    expect(resolved).not.toBeNull();
    expect(resolved!.modelConfig.upstream).toBe("model-1-upstream");
    expect(resolved!.providerConfig.name).toBe("test-provider");
    expect(resolved!.handler).toBe(mockHandler);
  });

  it("scopes lookup by endpoint prefix", () => {
    const provider1: ProviderConfig = {
      version: 1,
      type: "test",
      name: "provider-1",
      api_key: "key",
      base_url: "https://test.example.com",
      anthropic_url: null,
      auth_header: "Authorization",
      auth_prefix: "Bearer ",
      timeout: 120000,
      endpoint: "",
      models: [{ id: "model-a", upstream: "model-a", context_length: 128000, max_output_tokens: 16384, description: "a", created: 1700000000 }],
      capabilities: {},
      web_search: null,
    };
    const provider2: ProviderConfig = {
      ...provider1,
      name: "provider-2",
      endpoint: "/tp",
      models: [{ id: "model-b", upstream: "model-b", context_length: 128000, max_output_tokens: 16384, description: "b", created: 1700000000 }],
    };
    (registry as any).providers = [provider1, provider2];
    (registry as any).buildIndex();

    expect(registry.lookup("model-a", "")).not.toBeNull();
    expect(registry.lookup("model-a", "/tp")).toBeNull();
    expect(registry.lookup("model-b", "/tp")).not.toBeNull();
    expect(registry.lookup("model-b", "")).toBeNull();
  });

  it("getAllModels returns all models at endpoint", () => {
    const provider: ProviderConfig = {
      version: 1,
      type: "test",
      name: "test-provider",
      api_key: "key",
      base_url: "https://test.example.com",
      anthropic_url: null,
      auth_header: "Authorization",
      auth_prefix: "Bearer ",
      timeout: 120000,
      endpoint: "",
      models: [
        { id: "m1", upstream: "m1", context_length: 128000, max_output_tokens: 16384, description: "m1", created: 1700000000 },
        { id: "m2", upstream: "m2", context_length: 128000, max_output_tokens: 16384, description: "m2", created: 1700000000 },
      ],
      capabilities: {},
      web_search: null,
    };
    (registry as any).providers = [provider];
    (registry as any).buildIndex();

    const models = registry.getAllModels("");
    expect(models).toHaveLength(2);
    expect(models[0].model.id).toBe("m1");
    expect(models[0].providerName).toBe("test-provider");
  });
});
