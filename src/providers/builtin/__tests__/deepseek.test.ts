import { describe, it, expect } from "vitest";
import { deepseekHandler } from "../deepseek";
import type { ModelConfig, ProviderConfig } from "../../types";

const baseModel: ModelConfig = {
  id: "deepseek-v4-flash",
  upstream: "deepseek-v4-flash",
  context_length: 1000000,
  max_output_tokens: 384000,
  description: "deepseek-v4-flash",
};

const baseProviderConfig: ProviderConfig = {
  version: 1,
  type: "deepseek",
  name: "deepseek",
  api_key: "test-key",
  base_url: "https://api.deepseek.com",
  anthropic_url: null,
  auth_header: "Authorization",
  auth_prefix: "Bearer ",
  timeout: 120000,
  endpoint: "",
  models: [],
  capabilities: {},
  web_search: null,
};

describe("deepseekHandler", () => {
  describe("getOpenAIUrl", () => {
    it("appends /v1/chat/completions", () => {
      expect(deepseekHandler.getOpenAIUrl("https://api.deepseek.com")).toBe(
        "https://api.deepseek.com/v1/chat/completions",
      );
    });
  });

  describe("getAnthropicUrl", () => {
    it("appends /v1/messages", () => {
      expect(deepseekHandler.getAnthropicUrl("https://api.deepseek.com/anthropic")).toBe(
        "https://api.deepseek.com/anthropic/v1/messages",
      );
    });
  });

  describe("getDefaultBaseUrl", () => {
    it("returns DeepSeek default base URL", () => {
      expect(deepseekHandler.getDefaultBaseUrl()).toBe("https://api.deepseek.com");
    });
  });

  describe("getDefaultAnthropicUrl", () => {
    it("returns DeepSeek default Anthropic URL", () => {
      expect(deepseekHandler.getDefaultAnthropicUrl()).toBe("https://api.deepseek.com/anthropic");
    });
  });

  describe("transformRequest", () => {
    it("preserves max_tokens as-is", () => {
      const body: Record<string, unknown> = { model: "deepseek-v4-flash", max_tokens: 1000 };
      const original = { model: "deepseek-v4-flash" };
      deepseekHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["max_tokens"]).toBe(1000);
      expect(body["max_completion_tokens"]).toBeUndefined();
    });

    it("filters out non-function tools", () => {
      const body: Record<string, unknown> = {
        model: "deepseek-v4-flash",
        tools: [
          { type: "function", function: { name: "my_func" } },
          { type: "retrieval" },
        ],
      };
      const original = { model: "deepseek-v4-flash" };
      deepseekHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tools"]).toEqual([{ type: "function", function: { name: "my_func" } }]);
    });

    it("deletes tools and tool_choice when no tools remain", () => {
      const body: Record<string, unknown> = { model: "deepseek-v4-flash", tools: [{ type: "retrieval" }], tool_choice: "auto" };
      const original = { model: "deepseek-v4-flash" };
      deepseekHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tools"]).toBeUndefined();
      expect(body["tool_choice"]).toBeUndefined();
    });

    it("deletes tool_choice when tools is absent", () => {
      const body: Record<string, unknown> = { model: "deepseek-v4-flash", tool_choice: "auto" };
      const original = { model: "deepseek-v4-flash" };
      deepseekHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tool_choice"]).toBeUndefined();
    });
  });
});
