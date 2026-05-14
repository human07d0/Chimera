import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import path from "path";
import { SqliteStorage } from "../storage/sqlite";
import { MonitorEvent } from "../storage/index";
import { unlinkSync, existsSync } from "fs";

const TEST_DB_PATH = path.resolve(__dirname, "../../data/test-monitor.db");

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

describe("SqliteStorage", () => {
  let storage: SqliteStorage;

  beforeAll(async () => {
    await SqliteStorage.initSqlModule();
  });

  beforeEach(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    storage = new SqliteStorage(TEST_DB_PATH);
    storage.init();
  });

  afterAll(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe("append and query with source", () => {
    it("stores and retrieves source field", () => {
      storage.append(makeEvent({ source: "main" }));
      storage.append(makeEvent({ source: "token-plan" }));

      const events = storage.query({ days: 1 });
      expect(events).toHaveLength(2);

      const mainEvent = events.find((e) => e.source === "main");
      const tpEvent = events.find((e) => e.source === "token-plan");
      expect(mainEvent).toBeDefined();
      expect(tpEvent).toBeDefined();
    });

    it("defaults source to main when not specified", () => {
      const event = makeEvent();
      delete (event as any).source;
      event.source = "main";
      storage.append(event);

      const events = storage.query({ days: 1 });
      expect(events[0].source).toBe("main");
    });
  });

  describe("stats - source filter", () => {
    it("returns all records when source is not specified", () => {
      storage.append(makeEvent({ source: "main", input_tokens: 100, output_tokens: 50 }));
      storage.append(makeEvent({ source: "token-plan", input_tokens: 200, output_tokens: 80 }));

      const result = storage.stats({ days: 1 });
      expect(result.totalCalls).toBe(2);
      expect(result.totalInputTokens).toBe(300);
      expect(result.totalOutputTokens).toBe(130);
    });

    it("filters by source=main", () => {
      storage.append(makeEvent({ source: "main", input_tokens: 100, output_tokens: 50 }));
      storage.append(makeEvent({ source: "token-plan", input_tokens: 200, output_tokens: 80 }));

      const result = storage.stats({ days: 1, source: "main" });
      expect(result.totalCalls).toBe(1);
      expect(result.totalInputTokens).toBe(100);
      expect(result.totalOutputTokens).toBe(50);
    });

    it("filters by source=token-plan", () => {
      storage.append(makeEvent({ source: "main", input_tokens: 100, output_tokens: 50 }));
      storage.append(makeEvent({ source: "token-plan", input_tokens: 200, output_tokens: 80 }));

      const result = storage.stats({ days: 1, source: "token-plan" });
      expect(result.totalCalls).toBe(1);
      expect(result.totalInputTokens).toBe(200);
      expect(result.totalOutputTokens).toBe(80);
    });
  });

  describe("stats - totalTokens", () => {
    it("calculates totalTokens as input + output", () => {
      storage.append(makeEvent({ input_tokens: 1000, output_tokens: 500 }));
      storage.append(makeEvent({ input_tokens: 2000, output_tokens: 300 }));

      const result = storage.stats({ days: 1 });
      expect(result.totalTokens).toBe(3800);
    });

    it("returns 0 totalTokens when no records", () => {
      const result = storage.stats({ days: 1 });
      expect(result.totalTokens).toBe(0);
    });
  });

  describe("trend", () => {
    beforeEach(() => {
      storage.prune(-1);
    });

    it("returns empty array when no records", () => {
      const result = storage.trend({ days: 7, granularity: "day" });
      expect(result).toEqual([]);
    });

    it("buckets records by day", () => {
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      storage.append(makeEvent({ ts_start: now - 0 * oneDayMs, input_tokens: 100, output_tokens: 50, cost: 0.01, latency_ms: 200 }));
      storage.append(makeEvent({ ts_start: now - 1 * oneDayMs, input_tokens: 200, output_tokens: 80, cost: 0.02, latency_ms: 300 }));
      storage.append(makeEvent({ ts_start: now - 2 * oneDayMs, input_tokens: 300, output_tokens: 120, cost: 0.03, latency_ms: 400 }));

      const result = storage.trend({ days: 7, granularity: "day" });
      expect(result.length).toBe(3);
      const day0 = result.find(b => b.calls === 1 && b.tokens === 150);
      expect(day0).toBeDefined();
      expect(day0!.cost).toBeCloseTo(0.01);
      expect(day0!.latency_ms).toBe(200);
    });

    it("filters by model", () => {
      const now = Date.now();
      storage.append(makeEvent({ model_requested: "mimo-v2-flash", input_tokens: 100, output_tokens: 50, cost: 0.01, latency_ms: 100 }));
      storage.append(makeEvent({ model_requested: "mimo-v2-pro", input_tokens: 200, output_tokens: 80, cost: 0.02, latency_ms: 200 }));

      const result = storage.trend({ days: 1, granularity: "day", model: "mimo-v2-flash" });
      expect(result.length).toBe(1);
      expect(result[0].calls).toBe(1);
      expect(result[0].tokens).toBe(150);
    });

    it("filters by source", () => {
      const now = Date.now();
      storage.append(makeEvent({ source: "main", input_tokens: 100, output_tokens: 50, cost: 0.01, latency_ms: 100 }));
      storage.append(makeEvent({ source: "token-plan", input_tokens: 200, output_tokens: 80, cost: 0.02, latency_ms: 200 }));

      const result = storage.trend({ days: 1, granularity: "day", source: "main" });
      expect(result.length).toBe(1);
      expect(result[0].calls).toBe(1);
    });
  });
});