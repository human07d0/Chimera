import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  ProviderHandler,
  ProviderConfig,
  ModelConfig,
  ResolvedModel,
} from "../types";

describe("provider types", () => {
  it("ModelConfig has required fields", () => {
    expectTypeOf<ModelConfig>().toHaveProperty("id");
    expectTypeOf<ModelConfig>().toHaveProperty("upstream");
    expectTypeOf<ModelConfig>().toHaveProperty("context_length");
    expectTypeOf<ModelConfig>().toHaveProperty("max_output_tokens");
    expectTypeOf<ModelConfig>().toHaveProperty("description");
    expectTypeOf<ModelConfig>().toHaveProperty("created");
  });

  it("ModelConfig has optional fields", () => {
    expectTypeOf<ModelConfig["default"]>().toEqualTypeOf<
      Record<string, unknown> | undefined
    >();
    expectTypeOf<ModelConfig["capabilities"]>().toEqualTypeOf<
      Record<string, unknown> | undefined
    >();
    expectTypeOf<ModelConfig["pricing"]>().toEqualTypeOf<
      | {
          input: number;
          cached_input?: number;
          output: number;
        }
      | undefined
    >();
  });

  it("ProviderConfig has required fields", () => {
    expectTypeOf<ProviderConfig>().toHaveProperty("version");
    expectTypeOf<ProviderConfig>().toHaveProperty("type");
    expectTypeOf<ProviderConfig>().toHaveProperty("name");
    expectTypeOf<ProviderConfig>().toHaveProperty("api_key");
    expectTypeOf<ProviderConfig>().toHaveProperty("base_url");
    expectTypeOf<ProviderConfig>().toHaveProperty("anthropic_url");
    expectTypeOf<ProviderConfig>().toHaveProperty("auth_header");
    expectTypeOf<ProviderConfig>().toHaveProperty("auth_prefix");
    expectTypeOf<ProviderConfig>().toHaveProperty("timeout");
    expectTypeOf<ProviderConfig>().toHaveProperty("endpoint");
    expectTypeOf<ProviderConfig>().toHaveProperty("models");
    expectTypeOf<ProviderConfig>().toHaveProperty("capabilities");
    expectTypeOf<ProviderConfig>().toHaveProperty("web_search");
  });

  it("ProviderHandler has required methods", () => {
    expectTypeOf<ProviderHandler>().toHaveProperty("type");
    expectTypeOf<ProviderHandler["getOpenAIUrl"]>().toBeFunction();
    expectTypeOf<ProviderHandler["getAnthropicUrl"]>().toBeFunction();
    expectTypeOf<ProviderHandler["getDefaultBaseUrl"]>().toBeFunction();
    expectTypeOf<ProviderHandler["getDefaultAnthropicUrl"]>().toBeFunction();
    expectTypeOf<ProviderHandler["transformRequest"]>().toBeFunction();
  });

  it("ResolvedModel references all provider types", () => {
    expectTypeOf<ResolvedModel>().toHaveProperty("handler");
    expectTypeOf<ResolvedModel>().toHaveProperty("providerConfig");
    expectTypeOf<ResolvedModel>().toHaveProperty("modelConfig");
    expectTypeOf<ResolvedModel["handler"]>().toEqualTypeOf<ProviderHandler>();
    expectTypeOf<ResolvedModel["providerConfig"]>().toEqualTypeOf<ProviderConfig>();
    expectTypeOf<ResolvedModel["modelConfig"]>().toEqualTypeOf<ModelConfig>();
  });

  it("constructs a valid ModelConfig object", () => {
    const model: ModelConfig = {
      id: "mimo-v2-pro",
      upstream: "mimo-v2-pro",
      context_length: 1_000_000,
      max_output_tokens: 128_000,
      description: "MiMo V2 Pro",
      created: 1_700_000_000,
      pricing: { input: 0.5, output: 1.0 },
    };
    expect(model.id).toBe("mimo-v2-pro");
  });

  it("constructs a valid ProviderConfig object", () => {
    const provider: ProviderConfig = {
      version: 1,
      type: "builtin",
      name: "mimo",
      api_key: "test-key",
      base_url: "https://api.example.com",
      anthropic_url: null,
      auth_header: "Authorization",
      auth_prefix: "Bearer ",
      timeout: 30,
      endpoint: "/v1/chat/completions",
      models: [],
      capabilities: {},
      web_search: null,
    };
    expect(provider.type).toBe("builtin");
  });
});
