import { describe, it, expect } from "vitest";
import { aliyunHandler } from "../aliyun";
import type { ModelConfig, ProviderConfig } from "../../types";

const baseModel: ModelConfig = {
  id: "qwen3-235b-a22b",
  upstream: "qwen3-235b-a22b",
  context_length: 131072,
  max_output_tokens: 8192,
  description: "qwen3-235b-a22b",
};

const baseProviderConfig: ProviderConfig = {
  version: 1,
  type: "aliyun",
  name: "aliyun",
  api_key: "test-key",
  base_url: "https://dashscope.aliyuncs.com/compatible-mode",
  anthropic_url: null,
  auth_header: "Authorization",
  auth_prefix: "Bearer ",
  timeout: 120000,
  endpoint: "",
  models: [],
  capabilities: {},
  web_search: null,
};

describe("aliyunHandler", () => {
  describe("type", () => {
    it("is aliyun", () => {
      expect(aliyunHandler.type).toBe("aliyun");
    });
  });

  describe("getOpenAIUrl", () => {
    it("appends /v1/chat/completions", () => {
      expect(aliyunHandler.getOpenAIUrl("https://dashscope.aliyuncs.com/compatible-mode")).toBe(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      );
    });
  });

  describe("getAnthropicUrl", () => {
    it("appends /v1/messages", () => {
      expect(aliyunHandler.getAnthropicUrl("https://dashscope.aliyuncs.com/apps/anthropic")).toBe(
        "https://dashscope.aliyuncs.com/apps/anthropic/v1/messages",
      );
    });
  });

  describe("getDefaultBaseUrl", () => {
    it("returns Aliyun default base URL", () => {
      expect(aliyunHandler.getDefaultBaseUrl()).toBe("https://dashscope.aliyuncs.com/compatible-mode");
    });
  });

  describe("getDefaultAnthropicUrl", () => {
    it("returns Aliyun default Anthropic URL", () => {
      expect(aliyunHandler.getDefaultAnthropicUrl()).toBe("https://dashscope.aliyuncs.com/apps/anthropic");
    });
  });

  describe("transformRequest", () => {
    it("preserves max_tokens as-is", () => {
      const body: Record<string, unknown> = { model: "qwen3-235b-a22b", max_tokens: 1000 };
      const original = { model: "qwen3-235b-a22b" };
      aliyunHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["max_tokens"]).toBe(1000);
      expect(body["max_completion_tokens"]).toBeUndefined();
    });

    it("filters out non-function tools", () => {
      const body: Record<string, unknown> = {
        model: "qwen3-235b-a22b",
        tools: [
          { type: "function", function: { name: "my_func" } },
          { type: "retrieval" },
        ],
      };
      const original = { model: "qwen3-235b-a22b" };
      aliyunHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tools"]).toEqual([{ type: "function", function: { name: "my_func" } }]);
    });

    it("deletes tools and tool_choice when no tools remain", () => {
      const body: Record<string, unknown> = { model: "qwen3-235b-a22b", tools: [{ type: "retrieval" }], tool_choice: "auto" };
      const original = { model: "qwen3-235b-a22b" };
      aliyunHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tools"]).toBeUndefined();
      expect(body["tool_choice"]).toBeUndefined();
    });

    it("deletes tool_choice when tools is absent", () => {
      const body: Record<string, unknown> = { model: "qwen3-235b-a22b", tool_choice: "auto" };
      const original = { model: "qwen3-235b-a22b" };
      aliyunHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tool_choice"]).toBeUndefined();
    });

    it("passes through enable_search, enable_thinking, and search_options", () => {
      const body: Record<string, unknown> = {
        model: "qwen3-235b-a22b",
        enable_search: true,
        enable_thinking: true,
        search_options: { strategy: "standard" },
      };
      const original = { model: "qwen3-235b-a22b" };
      aliyunHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["enable_search"]).toBe(true);
      expect(body["enable_thinking"]).toBe(true);
      expect(body["search_options"]).toEqual({ strategy: "standard" });
    });
  });
});
