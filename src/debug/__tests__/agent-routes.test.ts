import { describe, it, expect, vi } from "vitest";
import { Request, Response } from "express";

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
    setHeader: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe("GET /debug/agent", () => {
  it("should return a valid JSON capabilities manifest", async () => {
    const { agentRouter } = await import("../agent-routes");

    const req = createMockReq();
    const res = createMockRes();

    const handler = (agentRouter as any).stack
      .find((layer: any) => layer.route?.path === "/" && layer.route?.methods?.get)
      ?.route?.stack?.[0]?.handle;

    expect(handler).toBeDefined();

    handler(req, res);

    const calledWith = (res.json as any).mock.calls[0][0];

    expect(calledWith).toHaveProperty("success", true);
    expect(calledWith).toHaveProperty("data");
    expect(calledWith.data).toHaveProperty("description");
    expect(calledWith.data).toHaveProperty("endpoints");
    expect(Array.isArray(calledWith.data.endpoints)).toBe(true);
    expect(calledWith.data.endpoints.length).toBeGreaterThan(0);

    for (const ep of calledWith.data.endpoints) {
      expect(ep).toHaveProperty("method");
      expect(ep).toHaveProperty("path");
      expect(ep).toHaveProperty("description");
    }

    expect(calledWith.data).toHaveProperty("data_schema");
    expect(calledWith.data.data_schema).toHaveProperty("DebugEvent");

    const debugEvent = calledWith.data.data_schema.DebugEvent;
    expect(debugEvent).toHaveProperty("request_id", "string");
    expect(debugEvent).toHaveProperty("ts_start", "number");
    expect(debugEvent).toHaveProperty("ts_end", "number");
    expect(debugEvent).toHaveProperty("path", "string");
    expect(debugEvent).toHaveProperty("method", "string");
    expect(debugEvent).toHaveProperty("status_code", "number");
    expect(debugEvent).toHaveProperty("model_requested", "string");
    expect(debugEvent).toHaveProperty("model_upstream", "string");
    expect(debugEvent).toHaveProperty("provider_name", "string");
    expect(debugEvent).toHaveProperty("stream", "boolean");
    expect(debugEvent).toHaveProperty("request_body", "string");
    expect(debugEvent).toHaveProperty("response_body", "string");
    expect(debugEvent).toHaveProperty("error_type", "string | null");
    expect(debugEvent).toHaveProperty("error_body", "string | null");
  });
});
