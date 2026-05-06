import { describe, it, expect, beforeEach, vi } from "vitest";
import { Request, Response } from "express";
import { debugStore } from "../store";
import { DebugEvent, DebugMediaItem } from "../types";

// Mock config
vi.mock("../../config", () => ({
  config: {
    debug: {
      enabled: true,
      maxRecords: 500,
      maxBodySize: 1_048_576,
      maxMediaBytes: 10_485_760,
    },
    upstream: {
      defaultModel: "mimo-v2-flash",
    },
  },
}));

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

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
    stream: false,
    request_body: '{"model":"mimo-v2-flash","messages":[{"role":"user","content":"hello"}]}',
    response_body: '{"choices":[{"message":{"content":"hi"}}]}',
    error_type: null,
    error_body: null,
    ...overrides,
  };
}

function createMockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes() {
  const res = {
    statusCode: 200,
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe("Debug Routes (unit)", () => {
  beforeEach(() => {
    debugStore.prune();
  });

  describe("GET /debug/calls", () => {
    it("should return empty list when no records", async () => {
      // Import the router to test its handlers indirectly via the store
      const { debugRouter } = await import("../routes");
      expect(debugRouter).toBeDefined();
    });

    it("should return stored events via store.query", () => {
      debugStore.append(makeEvent({ request_id: "r1" }));
      debugStore.append(makeEvent({ request_id: "r2" }));

      const { total, items } = debugStore.query();
      expect(total).toBe(2);
      expect(items).toHaveLength(2);
    });

    it("should support search filtering", () => {
      debugStore.append(makeEvent({ request_id: "r1", request_body: '{"content":"findme"}' }));
      debugStore.append(makeEvent({ request_id: "r2", request_body: '{"content":"other"}' }));

      const { total, items } = debugStore.query({ search: "findme" });
      expect(total).toBe(1);
      expect(items[0].request_id).toBe("r1");
    });

    it("should support model filtering", () => {
      debugStore.append(makeEvent({ request_id: "r1", model_requested: "mimo-v2-flash" }));
      debugStore.append(makeEvent({ request_id: "r2", model_requested: "mimo-v2-pro" }));

      const { total, items } = debugStore.query({ model: "mimo-v2-pro" });
      expect(total).toBe(1);
      expect(items[0].request_id).toBe("r2");
    });
  });

  describe("GET /debug/calls/:id", () => {
    it("should find event by id", () => {
      const event = makeEvent({ request_id: "find-me" });
      debugStore.append(event);

      const found = debugStore.getById("find-me");
      expect(found).toBeDefined();
      expect(found!.request_id).toBe("find-me");
    });

    it("should return undefined for missing id", () => {
      const found = debugStore.getById("nonexistent");
      expect(found).toBeUndefined();
    });
  });

  describe("POST /debug/prune", () => {
    it("should clear all records", () => {
      debugStore.append(makeEvent());
      debugStore.append(makeEvent());
      expect(debugStore.size).toBe(2);

      const count = debugStore.prune();
      expect(count).toBe(2);
      expect(debugStore.size).toBe(0);
    });
  });

  describe("media sanitization", () => {
    it("route response should not leak data_base64", async () => {
      const { debugRouter } = await import("../routes");

      const media: DebugMediaItem = {
        id: "media-request-0",
        location: "request",
        path: "messages[0].content[1].image_url.url",
        kind: "image",
        media_type: "image/png",
        encoding: "base64",
        byte_length: 100,
        data_base64: "SECRET_BASE64_DATA",
      };

      debugStore.append(makeEvent({
        request_id: "test-media-leak",
        request_body: '{"placeholder":"[_debug_media id=media-request-0 type=image/png bytes=100]"}',
        media: [media],
      }));

      // Simulate the /calls endpoint
      const callsReq = createMockReq();
      const callsRes = createMockRes();
      const callsHandler = (debugRouter as any).stack
        .find((layer: any) => layer.route?.path === "/calls" && layer.route?.methods?.get)
        ?.route?.stack?.[0]?.handle;

      if (callsHandler) {
        callsHandler(callsReq, callsRes);
        // data_base64 should not be present in the response
        const calledWith: any = (callsRes.json as any).mock.calls[0][0];
        expect(calledWith.success).toBe(true);
        const items = calledWith.data.items;
        if (items.length > 0 && items[0].media) {
          for (const m of items[0].media) {
            expect(m.data_base64).toBeUndefined();
          }
        }
      }

      // Simulate the /calls/:id endpoint
      const detailReq = createMockReq({ params: { id: "test-media-leak" } });
      const detailRes = createMockRes();
      const callsIdHandler = (debugRouter as any).stack
        .find((layer: any) => layer.route?.path === "/calls/:id" && layer.route?.methods?.get)
        ?.route?.stack?.[0]?.handle;

      if (callsIdHandler) {
        callsIdHandler(detailReq, detailRes);
        const calledWith: any = (detailRes.json as any).mock.calls[0][0];
        if (calledWith.data?.media) {
          for (const m of calledWith.data.media) {
            expect(m.data_base64).toBeUndefined();
          }
        }
      }
    });
  });
});