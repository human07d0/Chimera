import { describe, it, expect, beforeEach, vi } from "vitest";
import { Request, Response } from "express";

vi.mock("../../config", () => ({
  config: {
    get: vi.fn((key: string) => {
      if (key === "monitor.storage") return "memory";
      return undefined;
    }),
    monitor: {
      storage: "memory",
      sqlitePath: "./data/monitor.db",
      retentionDays: 30,
      flushIntervalMs: 200,
      flushBatchSize: 100,
      queueMaxSize: 10_000,
    },
    proxyApiKey: "",
    debug: {
      enabled: false,
      maxRecords: 500,
      maxBodySize: 1_048_576,
      maxMediaBytes: 10_485_760,
    },
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

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

describe("Trend API Route", () => {
  describe("GET /trend", () => {
    it("should return 200 with empty buckets for no data", async () => {
      const { monitorRouter } = await import("../routes");

      const req = createMockReq({ query: { days: "3" } });
      const res = createMockRes();

      const handler = (monitorRouter as any).stack
        .find((layer: any) => layer.route?.path === "/trend" && layer.route?.methods?.get)
        ?.route?.stack?.[0]?.handle;

      expect(handler).toBeDefined();
      handler(req, res);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { buckets: [] } });
    });

    it("should return buckets with default granularity day", async () => {
      const { monitorRouter } = await import("../routes");

      const req = createMockReq({ query: {} });
      const res = createMockRes();

      const handler = (monitorRouter as any).stack
        .find((layer: any) => layer.route?.path === "/trend" && layer.route?.methods?.get)
        ?.route?.stack?.[0]?.handle;

      handler(req, res);
      const result = (res.json as any).mock.calls[0][0];
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("buckets");
      expect(Array.isArray(result.data.buckets)).toBe(true);
    });
  });
});
