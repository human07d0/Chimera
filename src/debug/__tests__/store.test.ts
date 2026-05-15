import { describe, it, expect, beforeEach } from "vitest";
import { DebugStore } from "../store";
import { DebugEvent } from "../types";

function makeEvent(overrides: Partial<DebugEvent> = {}): DebugEvent {
  return {
    request_id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts_start: Date.now(),
    ts_end: Date.now() + 100,
    path: "/v1/chat/completions",
    method: "POST",
    status_code: 200,
    model_requested: "mimo-v2-flash",
    model_upstream: "mimo-v2-flash",
    provider_name: "mimo",
    stream: false,
    request_body: '{"model":"mimo-v2-flash","messages":[{"role":"user","content":"hello"}]}',
    response_body: '{"choices":[{"message":{"content":"hi"}}]}',
    error_type: null,
    error_body: null,
    ...overrides,
  };
}

describe("DebugStore", () => {
  let store: DebugStore;

  beforeEach(() => {
    store = new DebugStore(5); // small size for testing eviction
  });

  describe("append", () => {
    it("should add events", () => {
      store.append(makeEvent());
      expect(store.size).toBe(1);
    });

    it("should evict oldest when exceeding maxSize", () => {
      const events: DebugEvent[] = [];
      for (let i = 0; i < 7; i++) {
        const e = makeEvent({ request_id: `req-${i}` });
        events.push(e);
        store.append(e);
      }

      expect(store.size).toBe(5);
      // First two should be evicted
      expect(store.getById("req-0")).toBeUndefined();
      expect(store.getById("req-1")).toBeUndefined();
      // Last five should remain
      expect(store.getById("req-2")).toBeDefined();
      expect(store.getById("req-6")).toBeDefined();
    });
  });

  describe("query", () => {
    beforeEach(() => {
      store.append(makeEvent({ request_id: "r1", model_requested: "mimo-v2-flash", model_upstream: "mimo-v2-flash", ts_start: 100 }));
      store.append(makeEvent({ request_id: "r2", model_requested: "mimo-v2-pro", model_upstream: "mimo-v2-pro", ts_start: 200 }));
      store.append(makeEvent({ request_id: "r3", model_requested: "mimo-v2-flash", model_upstream: "mimo-v2-flash", ts_start: 300 }));
    });

    it("should return all items by default", () => {
      const { total, items } = store.query();
      expect(total).toBe(3);
      expect(items).toHaveLength(3);
    });

    it("should filter by model", () => {
      const { total, items } = store.query({ model: "mimo-v2-flash" });
      expect(total).toBe(2);
      expect(items.every((e) => e.model_requested === "mimo-v2-flash")).toBe(true);
    });

    it("should search in request_body", () => {
      store.append(makeEvent({ request_id: "r4", request_body: '{"messages":[{"content":"special_keyword"}]}' }));
      const { total, items } = store.query({ search: "special_keyword" });
      expect(total).toBe(1);
      expect(items[0].request_id).toBe("r4");
    });

    it("should search in response_body", () => {
      store.append(makeEvent({ request_id: "r5", response_body: '{"choices":[{"message":{"content":"unique_response"}}]}' }));
      const { total, items } = store.query({ search: "unique_response" });
      expect(total).toBe(1);
      expect(items[0].request_id).toBe("r5");
    });

    it("should apply limit and offset", () => {
      const { total, items } = store.query({ limit: 1, offset: 1 });
      expect(total).toBe(3);
      expect(items).toHaveLength(1);
    });

    it("should return results sorted by ts_start descending", () => {
      const { items } = store.query();
      expect(items[0].ts_start).toBeGreaterThanOrEqual(items[1].ts_start);
      expect(items[1].ts_start).toBeGreaterThanOrEqual(items[2].ts_start);
    });
  });

  describe("getById", () => {
    it("should find event by request_id", () => {
      const event = makeEvent({ request_id: "find-me" });
      store.append(event);
      expect(store.getById("find-me")).toBe(event);
    });

    it("should return undefined for non-existent id", () => {
      expect(store.getById("nope")).toBeUndefined();
    });
  });

  describe("prune", () => {
    it("should clear all events and return count", () => {
      store.append(makeEvent());
      store.append(makeEvent());
      const count = store.prune();
      expect(count).toBe(2);
      expect(store.size).toBe(0);
    });
  });
});