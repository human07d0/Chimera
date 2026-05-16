import { describe, it, expect } from "vitest";
import { kimiHandler } from "../kimi";
import type { ModelConfig, ProviderConfig } from "../../types";

const baseModel: ModelConfig = {
  id: "kimi-k2.5",
  upstream: "kimi-k2.5",
  context_length: 1_000_000,
  max_output_tokens: 64_000,
  description: "kimi-k2.5",
  created: 1700000000,
};

const baseProviderConfig: ProviderConfig = {
  version: 1,
  type: "kimi",
  name: "kimi",
  api_key: "test-key",
  base_url: "https://api.moonshot.cn",
  anthropic_url: null,
  auth_header: "Authorization",
  auth_prefix: "Bearer ",
  timeout: 120000,
  endpoint: "",
  models: [],
  capabilities: {},
  web_search: null,
};

describe("kimiHandler", () => {
  describe("type", () => {
    it("is kimi", () => {
      expect(kimiHandler.type).toBe("kimi");
    });
  });

  describe("getOpenAIUrl", () => {
    it("appends /v1/chat/completions", () => {
      expect(kimiHandler.getOpenAIUrl("https://api.moonshot.cn")).toBe(
        "https://api.moonshot.cn/v1/chat/completions",
      );
    });
  });

  describe("getAnthropicUrl", () => {
    it("returns null", () => {
      expect(kimiHandler.getAnthropicUrl("https://api.moonshot.cn")).toBeNull();
    });
  });

  describe("getDefaultBaseUrl", () => {
    it("returns moonshot URL", () => {
      expect(kimiHandler.getDefaultBaseUrl()).toBe("https://api.moonshot.cn");
    });
  });

  describe("getDefaultAnthropicUrl", () => {
    it("returns null", () => {
      expect(kimiHandler.getDefaultAnthropicUrl()).toBeNull();
    });
  });

  describe("transformRequest", () => {
    it("renames max_tokens to max_completion_tokens when client sent max_tokens", () => {
      const body: Record<string, unknown> = { model: "kimi-k2.5", max_tokens: 1000 };
      const original = { model: "kimi-k2.5", max_tokens: 1000 };
      kimiHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["max_completion_tokens"]).toBe(1000);
      expect(body["max_tokens"]).toBeUndefined();
    });

    it("does not overwrite max_completion_tokens when client sent both", () => {
      const body: Record<string, unknown> = { model: "kimi-k2.5", max_tokens: 1000, max_completion_tokens: 2000 };
      const original = { model: "kimi-k2.5", max_tokens: 1000, max_completion_tokens: 2000 };
      kimiHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["max_completion_tokens"]).toBe(2000);
      expect(body["max_tokens"]).toBeUndefined();
    });

    it("removes parallel_tool_calls", () => {
      const body: Record<string, unknown> = { model: "kimi-k2.5", parallel_tool_calls: true };
      const original = { model: "kimi-k2.5" };
      kimiHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["parallel_tool_calls"]).toBeUndefined();
    });

    it("filters out non-function tools", () => {
      const body: Record<string, unknown> = {
        model: "kimi-k2.5",
        tools: [
          { type: "function", function: { name: "my_func" } },
          { type: "retrieval" },
        ],
      };
      const original = { model: "kimi-k2.5" };
      kimiHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tools"]).toEqual([{ type: "function", function: { name: "my_func" } }]);
    });

    it("deletes tools and tool_choice when no tools remain", () => {
      const body: Record<string, unknown> = { model: "kimi-k2.5", tools: [{ type: "retrieval" }], tool_choice: "auto" };
      const original = { model: "kimi-k2.5" };
      kimiHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tools"]).toBeUndefined();
      expect(body["tool_choice"]).toBeUndefined();
    });

    it("deletes tool_choice when tools is absent", () => {
      const body: Record<string, unknown> = { model: "kimi-k2.5", tool_choice: "auto" };
      const original = { model: "kimi-k2.5" };
      kimiHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tool_choice"]).toBeUndefined();
    });
  });
});
