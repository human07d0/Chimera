import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

const mockGetCurrentConfig = vi.fn();
const mockUpdateConfig = vi.fn();
const mockIsWatcherActive = vi.fn();
const mockRequestShutdown = vi.fn();
const mockRequestRestart = vi.fn();
const mockLoggerInfo = vi.fn();
const mockGenerateSchema = vi.fn();
const mockGetProviders = vi.fn();
const mockGetEndpoints = vi.fn();
const mockGetAllModels = vi.fn();

vi.mock("../middleware", () => ({
  opsAuthMiddleware: vi.fn((_req: Request, _res: Response, next: () => void) => next()),
}));

vi.mock("../configManager", () => ({
  OpsConfigManager: {
    getCurrentConfig: (...args: unknown[]) => mockGetCurrentConfig(...args),
    updateConfig: (...args: unknown[]) => mockUpdateConfig(...args),
  },
}));

vi.mock("../watcher", () => ({
  isWatcherActive: (...args: unknown[]) => mockIsWatcherActive(...args),
}));

vi.mock("../../shutdownManager", () => ({
  requestShutdown: (...args: unknown[]) => mockRequestShutdown(...args),
  requestRestart: (...args: unknown[]) => mockRequestRestart(...args),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    debug: vi.fn(),
  },
}));

vi.mock("../../config", () => ({
  config: {
    proxyApiKey: "",
    opsPassword: "test-password",
    server: { port: 3000, host: "0.0.0.0" },
    monitor: {
      storage: "memory",
      sqlitePath: "./data/monitor.db",
      retentionDays: 30,
      flushIntervalMs: 200,
      flushBatchSize: 100,
      queueMaxSize: 10_000,
    },
    logLevel: "info",
    debug: {
      enabled: true,
      maxRecords: 500,
      maxBodySize: 1_048_576,
      maxMediaBytes: 10_485_760,
    },
  },
}));

vi.mock("../configSchema", () => ({
  generateSchema: (...args: unknown[]) => mockGenerateSchema(...args),
}));

vi.mock("../../providers/registry", () => ({
  modelRegistry: {
    getProviders: (...args: unknown[]) => mockGetProviders(...args),
    getEndpoints: (...args: unknown[]) => mockGetEndpoints(...args),
    getAllModels: (...args: unknown[]) => mockGetAllModels(...args),
  },
}));

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    headers: {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.body = data;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function findRouteHandler(
  router: unknown,
  method: string,
  path: string,
): (req: Request, res: Response) => void {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

describe("Ops Routes", () => {
  let opsRouter: import("express").Router;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockGetCurrentConfig.mockReturnValue({
      logLevel: "info",
      debugEnabled: true,
      sensitive: {},
    });
    mockUpdateConfig.mockReturnValue({ success: true });
    mockIsWatcherActive.mockReturnValue(false);
    mockGenerateSchema.mockReturnValue({
      logLevel: { key: "LOG_LEVEL", type: "string", description: "test" },
    });
    mockGetProviders.mockReturnValue([]);
    mockGetEndpoints.mockReturnValue([]);
    mockGetAllModels.mockReturnValue([]);

    const mod = await import("../routes");
    opsRouter = mod.opsRouter;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe("GET /info", () => {
    it("returns enabled and version", () => {
      const res = mockRes();
      findRouteHandler(opsRouter, "get", "/info")(mockReq(), res);

      expect(res.body).toEqual({
        success: true,
        data: {
          enabled: true,
          debugEnabled: expect.any(Boolean),
          debugAccessible: true,
          version: expect.any(String),
        },
      });
    });

    it("returns enabled false when opsPassword is empty", async () => {
      const { config } = await import("../../config");
      (config as any).opsPassword = "";

      const res = mockRes();
      findRouteHandler(opsRouter, "get", "/info")(mockReq(), res);

      expect((res.body as any).data.enabled).toBe(false);

      (config as any).opsPassword = "test-password";
    });

    it("does not require auth middleware", () => {
      const layer = (opsRouter as any).stack.find(
        (l: any) => l.route?.path === "/info",
      );
      expect(layer.route.stack).toHaveLength(1);
    });

    it("returns debugAccessible: false for non-local requests", () => {
      const res2 = mockRes();
      const nonLocalReq = mockReq({ socket: { remoteAddress: "10.0.0.1" } });
      findRouteHandler(opsRouter, "get", "/info")(nonLocalReq, res2);

      expect((res2.body as any).data.debugAccessible).toBe(false);
    });
  });

  describe("GET /config", () => {
    it("returns current config", () => {
      const res = mockRes();
      findRouteHandler(opsRouter, "get", "/config")(mockReq(), res);

      expect(res.body).toEqual({
        success: true,
        data: expect.objectContaining({
          logLevel: "info",
          debugEnabled: true,
        }),
      });
    });

    it("requires auth middleware", () => {
      const layer = (opsRouter as any).stack.find(
        (l: any) => l.route?.path === "/config" && l.route?.methods?.get,
      );
      expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("POST /config", () => {
    it("rejects null body with 400", () => {
      const res = mockRes();
      findRouteHandler(opsRouter, "post", "/config")(
        mockReq({ body: null }),
        res,
      );

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: expect.stringContaining("non-empty object"),
      });
    });

    it("rejects non-object body with 400", () => {
      const res = mockRes();
      findRouteHandler(opsRouter, "post", "/config")(
        mockReq({ body: "invalid" }),
        res,
      );

      expect(res.statusCode).toBe(400);
      expect((res.body as any).success).toBe(false);
    });

    it("rejects empty object body with 400", () => {
      const res = mockRes();
      findRouteHandler(opsRouter, "post", "/config")(
        mockReq({ body: {} }),
        res,
      );

      expect(res.statusCode).toBe(400);
      expect((res.body as any).success).toBe(false);
    });

    it("rejects when updateConfig returns failure", () => {
      mockUpdateConfig.mockReturnValue({
        success: false,
        error: "Unknown key: BAD_KEY",
      });

      const res = mockRes();
      findRouteHandler(opsRouter, "post", "/config")(
        mockReq({ body: { BAD_KEY: "value" } }),
        res,
      );

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: "Unknown key: BAD_KEY",
      });
    });

    it("returns updated config on success", () => {
      mockUpdateConfig.mockReturnValue({ success: true });
      mockGetCurrentConfig.mockReturnValue({
        logLevel: "debug",
        debugEnabled: false,
        sensitive: {},
      });

      const res = mockRes();
      findRouteHandler(opsRouter, "post", "/config")(
        mockReq({ body: { logLevel: "debug" } }),
        res,
      );

      expect(res.body).toEqual({
        success: true,
        message: "Configuration updated successfully",
        data: expect.objectContaining({ logLevel: "debug" }),
      });
    });

    it("requires auth middleware", () => {
      const layer = (opsRouter as any).stack.find(
        (l: any) => l.route?.path === "/config" && l.route?.methods?.post,
      );
      expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("GET /config/schema", () => {
    it("returns config schema", () => {
      mockGenerateSchema.mockReturnValue({
        logLevel: {
          key: "LOG_LEVEL",
          type: "string",
          description: "test",
          enum: ["error", "warn", "info", "debug"],
        },
      });

      const res = mockRes();
      findRouteHandler(opsRouter, "get", "/config/schema")(mockReq(), res);

      expect(res.body).toEqual({
        success: true,
        data: expect.objectContaining({
          logLevel: expect.objectContaining({
            key: "LOG_LEVEL",
            type: "string",
          }),
        }),
      });
    });

    it("requires auth middleware", () => {
      const layer = (opsRouter as any).stack.find(
        (l: any) =>
          l.route?.path === "/config/schema" && l.route?.methods?.get,
      );
      expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("GET /status", () => {
    it("returns status with expected fields", () => {
      mockGetProviders.mockReturnValue([]);
      mockGetEndpoints.mockReturnValue([]);
      mockGetAllModels.mockReturnValue([]);

      const res = mockRes();
      findRouteHandler(opsRouter, "get", "/status")(mockReq(), res);

      expect(res.body).toEqual({
        success: true,
        data: {
          uptime: expect.any(Number),
          pid: expect.any(Number),
          memory: expect.objectContaining({
            rss: expect.any(Number),
            heapTotal: expect.any(Number),
            heapUsed: expect.any(Number),
          }),
          watcherActive: false,
          nodeVersion: expect.any(String),
          platform: expect.any(String),
          arch: expect.any(String),
          providers: [],
        },
      });
    });

    it("returns provider info with model counts", () => {
      mockGetProviders.mockReturnValue([
        { name: "mimo", type: "mimo", endpoint: "" },
        { name: "deepseek", type: "deepseek", endpoint: "" },
      ]);
      mockGetEndpoints.mockReturnValue([""]);
      mockGetAllModels.mockReturnValue([
        { model: { id: "mimo-a" }, providerName: "mimo", providerType: "mimo" },
        { model: { id: "mimo-b" }, providerName: "mimo", providerType: "mimo" },
        { model: { id: "ds-a" }, providerName: "deepseek", providerType: "deepseek" },
      ]);

      const res = mockRes();
      findRouteHandler(opsRouter, "get", "/status")(mockReq(), res);

      const data = (res.body as any).data;
      expect(data.providers).toHaveLength(2);
      expect(data.providers[0]).toEqual({
        name: "mimo",
        type: "mimo",
        endpoint: "(default)",
        modelCount: 2,
      });
      expect(data.providers[1]).toEqual({
        name: "deepseek",
        type: "deepseek",
        endpoint: "(default)",
        modelCount: 1,
      });
    });

    it("reports watcherActive from isWatcherActive", () => {
      mockIsWatcherActive.mockReturnValue(true);

      const res = mockRes();
      findRouteHandler(opsRouter, "get", "/status")(mockReq(), res);

      expect((res.body as any).data.watcherActive).toBe(true);
    });

    it("requires auth middleware", () => {
      const layer = (opsRouter as any).stack.find(
        (l: any) => l.route?.path === "/status" && l.route?.methods?.get,
      );
      expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("POST /shutdown", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns success message", () => {
      const res = mockRes();
      findRouteHandler(opsRouter, "post", "/shutdown")(mockReq(), res);

      expect(res.body).toEqual({
        success: true,
        message: "Shutdown initiated",
      });
    });

    it("calls requestShutdown after delay", () => {
      findRouteHandler(opsRouter, "post", "/shutdown")(mockReq(), mockRes());

      expect(mockRequestShutdown).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      expect(mockRequestShutdown).toHaveBeenCalledOnce();
    });

    it("logs the request with ip", () => {
      findRouteHandler(opsRouter, "post", "/shutdown")(mockReq(), mockRes());

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Ops shutdown requested",
        { ip: "127.0.0.1" },
      );
    });

    it("requires auth middleware", () => {
      const layer = (opsRouter as any).stack.find(
        (l: any) => l.route?.path === "/shutdown" && l.route?.methods?.post,
      );
      expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("POST /restart", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns success message with hint", () => {
      const res = mockRes();
      findRouteHandler(opsRouter, "post", "/restart")(mockReq(), res);

      expect(res.body).toEqual({
        success: true,
        message: "Restart initiated",
        hint: expect.any(String),
      });
    });

    it("calls requestRestart after delay", () => {
      findRouteHandler(opsRouter, "post", "/restart")(mockReq(), mockRes());

      expect(mockRequestRestart).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      expect(mockRequestRestart).toHaveBeenCalledOnce();
    });

    it("logs the request with ip and watcher status", () => {
      mockIsWatcherActive.mockReturnValue(true);

      findRouteHandler(opsRouter, "post", "/restart")(mockReq(), mockRes());

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Ops restart requested",
        { ip: "127.0.0.1", watcherActive: true },
      );
    });

    it("requires auth middleware", () => {
      const layer = (opsRouter as any).stack.find(
        (l: any) => l.route?.path === "/restart" && l.route?.methods?.post,
      );
      expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
    });
  });
});
