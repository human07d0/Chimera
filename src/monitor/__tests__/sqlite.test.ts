import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { SqliteStorage } from "../storage/sqlite";
import { MonitorEvent } from "../storage/index";
import { unlinkSync, existsSync } from "fs";

const TEST_DB_PATH = "./data/test-monitor.db";

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
});