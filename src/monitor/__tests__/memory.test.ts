import { describe, it, expect, beforeEach } from "vitest";
import { memoryStorage } from "../storage/memory";
import { MonitorEvent } from "../storage/index";

function makeEvent(overrides: Partial<MonitorEvent> = {}): MonitorEvent {
  return {
    request_id: `req-${Math.random().toString(36).slice(2)}`,
    ts_start: Date.now(),
    ts_end: Date.now() + 100,
    latency_ms: 100,
    path: "/v1/chat/completions",
    method: "POST",
    status_code: 200,
    model_requested: "mimo-v2-flash",
    model_upstream: "mimo-v2-flash",
    stream: false,
    chunks: 0,
    bytes_out: 0,
    first_token_ms: null,
    input_tokens: 1000,
    output_tokens: 500,
    cached_prompt_tokens: 0,
    cost: 0.001,
    error_type: null,
    source: "main",
    ...overrides,
  };
}

describe("MemoryStorage", () => {
  beforeEach(() => {
    // 使用负数天数确保 cutoffTs 在未来，彻底清空所有记录
    memoryStorage.prune(-1);
  });

  describe("stats - source filter", () => {
    it("returns all records when source is not specified", () => {
      memoryStorage.append(makeEvent({ source: "main", input_tokens: 100, output_tokens: 50 }));
      memoryStorage.append(makeEvent({ source: "token-plan", input_tokens: 200, output_tokens: 80 }));

      const result = memoryStorage.stats({ days: 1 });
      expect(result.totalCalls).toBe(2);
      expect(result.totalInputTokens).toBe(300);
      expect(result.totalOutputTokens).toBe(130);
    });

    it("filters by source=main", () => {
      memoryStorage.append(makeEvent({ source: "main", input_tokens: 100, output_tokens: 50 }));
      memoryStorage.append(makeEvent({ source: "token-plan", input_tokens: 200, output_tokens: 80 }));

      const result = memoryStorage.stats({ days: 1, source: "main" });
      expect(result.totalCalls).toBe(1);
      expect(result.totalInputTokens).toBe(100);
      expect(result.totalOutputTokens).toBe(50);
    });

    it("filters by source=token-plan", () => {
      memoryStorage.append(makeEvent({ source: "main", input_tokens: 100, output_tokens: 50 }));
      memoryStorage.append(makeEvent({ source: "token-plan", input_tokens: 200, output_tokens: 80 }));

      const result = memoryStorage.stats({ days: 1, source: "token-plan" });
      expect(result.totalCalls).toBe(1);
      expect(result.totalInputTokens).toBe(200);
      expect(result.totalOutputTokens).toBe(80);
    });
  });

  describe("stats - totalTokens", () => {
    it("calculates totalTokens as input + output", () => {
      memoryStorage.append(makeEvent({ input_tokens: 1000, output_tokens: 500 }));
      memoryStorage.append(makeEvent({ input_tokens: 2000, output_tokens: 300 }));

      const result = memoryStorage.stats({ days: 1 });
      expect(result.totalTokens).toBe(3800);
    });

    it("returns 0 totalTokens when no records", () => {
      const result = memoryStorage.stats({ days: 1 });
      expect(result.totalTokens).toBe(0);
    });
  });
});