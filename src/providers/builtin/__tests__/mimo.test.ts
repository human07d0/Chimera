import { describe, it, expect } from "vitest";
import { mimoHandler } from "../mimo";
import type { ModelConfig, ProviderConfig } from "../../types";

const baseModel: ModelConfig = {
  id: "mimo-v2.5-pro",
  upstream: "mimo-v2.5-pro",
  context_length: 1_000_000,
  max_output_tokens: 128_000,
  description: "mimo-v2.5-pro",
  created: 1700000000,
};

const baseProviderConfig: ProviderConfig = {
  version: 1,
  type: "mimo",
  name: "xiaomi-mimo",
  api_key: "test-key",
  base_url: "https://api.xiaomimimo.com",
  anthropic_url: null,
  auth_header: "api-key",
  auth_prefix: "",
  timeout: 120000,
  endpoint: "",
  models: [],
  capabilities: {},
  web_search: { max_keyword: 3, force_search: false, limit: 5 },
};

describe("mimoHandler", () => {
  describe("getOpenAIUrl", () => {
    it("appends /v1/chat/completions", () => {
      expect(mimoHandler.getOpenAIUrl("https://api.xiaomimimo.com")).toBe(
        "https://api.xiaomimimo.com/v1/chat/completions",
      );
    });
  });

  describe("getAnthropicUrl", () => {
    it("appends /v1/messages", () => {
      expect(mimoHandler.getAnthropicUrl("https://api.xiaomimimo.com/anthropic")).toBe(
        "https://api.xiaomimimo.com/anthropic/v1/messages",
      );
    });
  });

  describe("getDefaultBaseUrl", () => {
    it("returns MiMo default base URL", () => {
      expect(mimoHandler.getDefaultBaseUrl()).toBe("https://api.xiaomimimo.com");
    });
  });

  describe("getDefaultAnthropicUrl", () => {
    it("returns MiMo default Anthropic URL", () => {
      expect(mimoHandler.getDefaultAnthropicUrl()).toBe("https://api.xiaomimimo.com/anthropic");
    });
  });

  describe("transformRequest", () => {
    it("renames max_tokens to max_completion_tokens when client sent max_tokens", () => {
      const body: Record<string, unknown> = { model: "mimo-v2.5-pro", max_tokens: 1000 };
      const original = { model: "mimo-v2.5-pro", max_tokens: 1000 };
      mimoHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["max_completion_tokens"]).toBe(1000);
      expect(body["max_tokens"]).toBeUndefined();
    });

    it("does not overwrite max_completion_tokens when client sent both", () => {
      const body: Record<string, unknown> = { model: "mimo-v2.5-pro", max_tokens: 1000, max_completion_tokens: 2000 };
      const original = { model: "mimo-v2.5-pro", max_tokens: 1000, max_completion_tokens: 2000 };
      mimoHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["max_completion_tokens"]).toBe(2000);
      expect(body["max_tokens"]).toBeUndefined();
    });

    it("preserves default max_completion_tokens when client did not send max_tokens", () => {
      const body: Record<string, unknown> = { model: "mimo-v2.5-pro", max_completion_tokens: 4096 };
      const original = { model: "mimo-v2.5-pro" };
      mimoHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["max_completion_tokens"]).toBe(4096);
    });

    it("converts web_search: true to tool object with provider defaults", () => {
      const body: Record<string, unknown> = { model: "mimo-v2.5-pro", web_search: true };
      const original = { model: "mimo-v2.5-pro" };
      mimoHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["web_search"]).toBeUndefined();
      expect(body["tools"]).toEqual([{ type: "web_search", max_keyword: 3, force_search: false, limit: 5 }]);
    });

    it("converts web_search object to tool with merged params", () => {
      const body: Record<string, unknown> = { model: "mimo-v2.5-pro", web_search: { max_keyword: 5 } };
      const original = { model: "mimo-v2.5-pro" };
      mimoHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tools"]).toEqual([{ type: "web_search", max_keyword: 5, force_search: false, limit: 5 }]);
    });

    it("merges web_search tool with existing function tools", () => {
      const body: Record<string, unknown> = {
        model: "mimo-v2.5-pro",
        web_search: true,
        tools: [{ type: "function", function: { name: "my_func" } }],
      };
      const original = { model: "mimo-v2.5-pro" };
      mimoHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tools"]).toEqual([
        { type: "web_search", max_keyword: 3, force_search: false, limit: 5 },
        { type: "function", function: { name: "my_func" } },
      ]);
    });

    it("filters out non-function, non-web_search tools", () => {
      const body: Record<string, unknown> = {
        model: "mimo-v2.5-pro",
        tools: [
          { type: "function", function: { name: "my_func" } },
          { type: "retrieval" },
        ],
      };
      const original = { model: "mimo-v2.5-pro" };
      mimoHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tools"]).toEqual([{ type: "function", function: { name: "my_func" } }]);
    });

    it("deletes tools and tool_choice when no tools remain", () => {
      const body: Record<string, unknown> = { model: "mimo-v2.5-pro", tools: [{ type: "retrieval" }], tool_choice: "auto" };
      const original = { model: "mimo-v2.5-pro" };
      mimoHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tools"]).toBeUndefined();
      expect(body["tool_choice"]).toBeUndefined();
    });

    it("deletes tool_choice when tools is absent", () => {
      const body: Record<string, unknown> = { model: "mimo-v2.5-pro", tool_choice: "auto" };
      const original = { model: "mimo-v2.5-pro" };
      mimoHandler.transformRequest(body, baseModel, original, baseProviderConfig);
      expect(body["tool_choice"]).toBeUndefined();
    });
  });
});
