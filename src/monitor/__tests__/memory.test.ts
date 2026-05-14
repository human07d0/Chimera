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
    provider_name: "unknown",
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

  describe("trend", () => {
    beforeEach(() => {
      memoryStorage.prune(-1);
    });

    it("returns empty array when no records", () => {
      const result = memoryStorage.trend({ days: 7, granularity: "day" });
      expect(result).toEqual([]);
    });

    it("buckets records by day", () => {
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      memoryStorage.append(makeEvent({ ts_start: now - 0 * oneDayMs, input_tokens: 100, output_tokens: 50, cost: 0.01, latency_ms: 200 }));
      memoryStorage.append(makeEvent({ ts_start: now - 1 * oneDayMs, input_tokens: 200, output_tokens: 80, cost: 0.02, latency_ms: 300 }));
      memoryStorage.append(makeEvent({ ts_start: now - 2 * oneDayMs, input_tokens: 300, output_tokens: 120, cost: 0.03, latency_ms: 400 }));

      const result = memoryStorage.trend({ days: 7, granularity: "day" });
      expect(result.length).toBe(3);
      const day0 = result.find(b => b.calls === 1 && b.tokens === 150);
      expect(day0).toBeDefined();
      expect(day0!.cost).toBeCloseTo(0.01);
      expect(day0!.latency_ms).toBe(200);
    });

    it("filters by model", () => {
      const now = Date.now();
      memoryStorage.append(makeEvent({ model_requested: "mimo-v2-flash", input_tokens: 100, output_tokens: 50, cost: 0.01, latency_ms: 100 }));
      memoryStorage.append(makeEvent({ model_requested: "mimo-v2-pro", input_tokens: 200, output_tokens: 80, cost: 0.02, latency_ms: 200 }));

      const result = memoryStorage.trend({ days: 1, granularity: "day", model: "mimo-v2-flash" });
      expect(result.length).toBe(1);
      expect(result[0].calls).toBe(1);
      expect(result[0].tokens).toBe(150);
    });

    it("filters by source", () => {
      const now = Date.now();
      memoryStorage.append(makeEvent({ source: "main", input_tokens: 100, output_tokens: 50, cost: 0.01, latency_ms: 100 }));
      memoryStorage.append(makeEvent({ source: "token-plan", input_tokens: 200, output_tokens: 80, cost: 0.02, latency_ms: 200 }));

      const result = memoryStorage.trend({ days: 1, granularity: "day", source: "main" });
      expect(result.length).toBe(1);
      expect(result[0].calls).toBe(1);
    });
  });
});