import { describe, it, expect, beforeEach } from "vitest";
import { memoryStorage, MemoryStorage } from "../storage/memory";
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

describe("MemoryStorage - ring buffer", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage(5);
  });

  describe("append", () => {
    it("stores records up to capacity", () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        storage.append(makeEvent({ ts_start: now + i }));
      }
      const result = storage.query({ days: 1, limit: 100 });
      expect(result).toHaveLength(5);
    });

    it("evicts oldest records when capacity exceeded", () => {
      const now = Date.now();
      for (let i = 0; i < 7; i++) {
        storage.append(makeEvent({ ts_start: now + i }));
      }
      const result = storage.query({ days: 1, limit: 100 });
      expect(result).toHaveLength(5);
    });

    it("keeps the newest records after overflow", () => {
      const now = Date.now();
      for (let i = 0; i < 7; i++) {
        storage.append(makeEvent({ ts_start: now + i, request_id: `req-${i}` }));
      }
      const result = storage.query({ days: 1, limit: 100 });
      const ids = result.map(r => r.request_id);
      expect(ids).toContain("req-6");
      expect(ids).toContain("req-5");
      expect(ids).toContain("req-4");
      expect(ids).toContain("req-3");
      expect(ids).toContain("req-2");
      expect(ids).not.toContain("req-0");
      expect(ids).not.toContain("req-1");
    });

    it("handles multiple wrap-around cycles", () => {
      const now = Date.now();
      for (let i = 0; i < 23; i++) {
        storage.append(makeEvent({ ts_start: now + i, request_id: `req-${i}` }));
      }
      const result = storage.query({ days: 1, limit: 100 });
      expect(result).toHaveLength(5);
      const ids = result.map(r => r.request_id);
      expect(ids).toContain("req-22");
      expect(ids).toContain("req-18");
      expect(ids).not.toContain("req-17");
    });
  });

  describe("query", () => {
    it("returns records sorted newest first", () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        storage.append(makeEvent({ ts_start: now + i }));
      }
      const result = storage.query({ days: 1, limit: 100 });
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].ts_start).toBeGreaterThanOrEqual(result[i].ts_start);
      }
    });

    it("returns records in correct order after wrap-around", () => {
      const now = Date.now();
      for (let i = 0; i < 8; i++) {
        storage.append(makeEvent({ ts_start: now + i, request_id: `req-${i}` }));
      }
      const result = storage.query({ days: 1, limit: 100 });
      expect(result[0].request_id).toBe("req-7");
      expect(result[4].request_id).toBe("req-3");
    });

    it("respects limit and offset", () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        storage.append(makeEvent({ ts_start: now + i }));
      }
      const result = storage.query({ days: 1, limit: 2, offset: 0 });
      expect(result).toHaveLength(2);
    });

    it("filters by model after wrap-around", () => {
      const now = Date.now();
      for (let i = 0; i < 7; i++) {
        storage.append(makeEvent({ ts_start: now + i, model_requested: i % 2 === 0 ? "model-a" : "model-b" }));
      }
      const result = storage.query({ days: 1, limit: 100, model: "model-a" });
      for (const r of result) {
        expect(r.model_requested).toBe("model-a");
      }
    });
  });

  describe("stats", () => {
    it("aggregates tokens correctly after wrap-around", () => {
      for (let i = 0; i < 7; i++) {
        storage.append(makeEvent({ ts_start: Date.now(), input_tokens: 100, output_tokens: 50 }));
      }
      const result = storage.stats({ days: 1 });
      expect(result.totalCalls).toBe(5);
      expect(result.totalInputTokens).toBe(500);
      expect(result.totalOutputTokens).toBe(250);
      expect(result.totalTokens).toBe(750);
    });

    it("returns zero stats when empty", () => {
      const result = storage.stats({ days: 1 });
      expect(result.totalCalls).toBe(0);
      expect(result.totalTokens).toBe(0);
    });
  });

  describe("trend", () => {
    it("produces correct buckets after wrap-around", () => {
      const now = Date.now();
      for (let i = 0; i < 7; i++) {
        storage.append(makeEvent({ ts_start: now, input_tokens: 100, output_tokens: 50, cost: 0.01, latency_ms: 100 }));
      }
      const result = storage.trend({ days: 1, granularity: "day" });
      expect(result.length).toBeGreaterThanOrEqual(1);
      const totalCalls = result.reduce((sum, b) => sum + b.calls, 0);
      expect(totalCalls).toBe(5);
    });
  });

  describe("prune", () => {
    it("removes old records and preserves newer ones", () => {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      storage.append(makeEvent({ ts_start: now - 10 * oneDay, request_id: "old-1" }));
      storage.append(makeEvent({ ts_start: now - 5 * oneDay, request_id: "old-2" }));
      storage.append(makeEvent({ ts_start: now - 1 * oneDay, request_id: "recent-1" }));
      storage.append(makeEvent({ ts_start: now, request_id: "recent-2" }));

      const removed = storage.prune(3);
      expect(removed).toBe(2);

      const result = storage.query({ days: 9999 });
      expect(result).toHaveLength(2);
      const ids = result.map(r => r.request_id);
      expect(ids).toContain("recent-1");
      expect(ids).toContain("recent-2");
    });

    it("returns 0 when nothing to prune", () => {
      storage.append(makeEvent({ ts_start: Date.now() }));
      const removed = storage.prune(30);
      expect(removed).toBe(0);
    });

    it("prunes correctly after ring buffer wrap-around", () => {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      for (let i = 0; i < 7; i++) {
        storage.append(makeEvent({ ts_start: now - (10 - i) * oneDay }));
      }
      const removed = storage.prune(5);
      expect(removed).toBeGreaterThan(0);
      const result = storage.query({ days: 9999 });
      for (const r of result) {
        expect(r.ts_start).toBeGreaterThanOrEqual(now - 5 * oneDay);
      }
    });
  });

  describe("default capacity", () => {
    it("uses 10_000 as default capacity", () => {
      const defaultStorage = new MemoryStorage();
      const now = Date.now();
      for (let i = 0; i < 10_001; i++) {
        defaultStorage.append(makeEvent({ ts_start: now + i }));
      }
      const result = defaultStorage.query({ days: 1, limit: 10_001 });
      expect(result).toHaveLength(10_000);
    });
  });
});