import { describe, it, expect } from "vitest";
import { chimeraHandler } from "../chimera";
import { builtinHandlers } from "../index";
import type { ModelConfig, ProviderConfig } from "../../types";

const baseModel: ModelConfig = {
  id: "gpt-4o",
  upstream: "gpt-4o",
  context_length: 128000,
  max_output_tokens: 4096,
  description: "GPT-4o",
};

const baseProviderConfig: ProviderConfig = {
  version: 1,
  type: "chimera",
  name: "test-chimera",
  api_key: "test-key",
  base_url: "http://upstream:3000",
  anthropic_url: null,
  auth_header: "Authorization",
  auth_prefix: "Bearer ",
  timeout: 120000,
  endpoint: "",
  models: [],
  capabilities: {},
  web_search: null,
};

describe("chimeraHandler", () => {
  it("has type 'chimera'", () => {
    expect(chimeraHandler.type).toBe("chimera");
  });

  describe("getOpenAIUrl", () => {
    it("appends /v1/chat/completions to base URL", () => {
      expect(chimeraHandler.getOpenAIUrl("http://upstream:3000")).toBe(
        "http://upstream:3000/v1/chat/completions",
      );
    });

    it("works with endpoint-prefixed base URL", () => {
      expect(chimeraHandler.getOpenAIUrl("http://upstream:3000/research")).toBe(
        "http://upstream:3000/research/v1/chat/completions",
      );
    });
  });

  describe("getAnthropicUrl", () => {
    it("appends /anthropic/v1/messages to base URL", () => {
      expect(chimeraHandler.getAnthropicUrl("http://upstream:3000")).toBe(
        "http://upstream:3000/anthropic/v1/messages",
      );
    });

    it("works with endpoint-prefixed base URL", () => {
      expect(chimeraHandler.getAnthropicUrl("http://upstream:3000/research")).toBe(
        "http://upstream:3000/research/anthropic/v1/messages",
      );
    });
  });

  describe("getDefaultBaseUrl", () => {
    it("returns null (no default, always from YAML)", () => {
      expect(chimeraHandler.getDefaultBaseUrl()).toBeNull();
    });
  });

  describe("getDefaultAnthropicUrl", () => {
    it("returns null (derived from base_url at runtime)", () => {
      expect(chimeraHandler.getDefaultAnthropicUrl()).toBeNull();
    });
  });

  describe("transformRequest", () => {
    it("is a no-op (passes body through unchanged)", () => {
      const body: Record<string, unknown> = {
        model: "gpt-4o",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 1000,
      };
      const original = { model: "gpt-4o" };

      chimeraHandler.transformRequest(body, baseModel, original, baseProviderConfig);

      expect(body["model"]).toBe("gpt-4o");
      expect(body["messages"]).toEqual([{ role: "user", content: "hello" }]);
      expect(body["max_tokens"]).toBe(1000);
    });

    it("does not add or remove any fields", () => {
      const body: Record<string, unknown> = {
        model: "gpt-4o",
        messages: [{ role: "user", content: "hello" }],
      };
      const original = { model: "gpt-4o" };

      const keysBefore = Object.keys(body);
      chimeraHandler.transformRequest(body, baseModel, original, baseProviderConfig);

      expect(Object.keys(body)).toEqual(keysBefore);
    });
  });
});

describe("builtinHandlers registration", () => {
  it("includes chimera handler", () => {
    expect(builtinHandlers.has("chimera")).toBe(true);
    expect(builtinHandlers.get("chimera")).toBe(chimeraHandler);
  });
});
