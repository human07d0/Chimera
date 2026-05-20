import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import fs from "fs";

const { mockGetStorageAsync, mockGetStorage, mockEndpointsRouter, mockPassThroughRouter, mockLocalhostGuard } = vi.hoisted(() => ({
  mockGetStorageAsync: vi.fn().mockResolvedValue({} as any),
  mockGetStorage: vi.fn(() => ({ prune: vi.fn() }) as any),
  mockEndpointsRouter: (() => {
    const express = require("express");
    const router = express.Router();
    router.get("/endpoints", (_req: any, res: any) => {
      res.json({ object: "list", endpoints: [] });
    });
    return router;
  })(),
  mockPassThroughRouter: require("express").Router(),
  mockLocalhostGuard: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock("../monitor/storage/factory", () => ({
  getStorage: mockGetStorage,
  getStorageAsync: mockGetStorageAsync,
}));

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../providers/registry", () => ({
  modelRegistry: {
    init: vi.fn(),
    getEndpoints: () => [""],
    getProviders: () => [],
    getAllModels: () => [],
  },
}));

vi.mock("../monitor/index", () => ({
  monitorRouter: mockPassThroughRouter,
  monitorMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../monitor/pricing", () => ({
  registerProviderPricing: vi.fn(),
}));

vi.mock("../ops/index", () => ({
  opsRouter: mockPassThroughRouter,
}));

vi.mock("../routes/chat", () => ({
  chatRouter: mockPassThroughRouter,
}));

vi.mock("../routes/anthropic", () => ({
  anthropicRouter: mockPassThroughRouter,
}));

vi.mock("../routes/models", () => ({
  modelsRouter: mockPassThroughRouter,
}));

vi.mock("../routes/endpoints", () => ({
  endpointsRouter: mockEndpointsRouter,
}));

vi.mock("../utils/auth", () => ({
  extractApiKey: (req: any) => {
    const authHeader = req.headers?.["authorization"];
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      return authHeader.slice("Bearer ".length).trim();
    }
    const apiKeyHeader = req.headers?.["api-key"];
    if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) {
      return apiKeyHeader.trim();
    }
    const xApiKeyHeader = req.headers?.["x-api-key"];
    if (typeof xApiKeyHeader === "string" && xApiKeyHeader.trim()) {
      return xApiKeyHeader.trim();
    }
    return null;
  },
}));

vi.mock("../debug", () => ({
  debugMiddleware: vi.fn(),
  debugRouter: require("express").Router(),
}));

vi.mock("../utils/localhostGuard", () => ({
  localhostGuard: mockLocalhostGuard,
}));

const { mockedConfig } = vi.hoisted(() => ({
  mockedConfig: {
    configDir: "/test/config",
    proxyApiKey: undefined as string | undefined,
    logLevel: "info",
    bodySizeLimit: () => "1mb",
    debug: { enabled: false },
    monitor: {
      storage: "memory",
      sqlitePath: ":memory:",
      retentionDays: 30,
    },
  },
}));

vi.mock("../config", () => ({
  config: mockedConfig,
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ""),
  },
}));

import { buildPlaygroundConfig } from "../server";

describe("buildPlaygroundConfig", () => {
  const mockGetAllModels = (endpoint: string) => {
    if (endpoint === "") return [
      { model: { id: "model-a" }, providerName: "p1", providerType: "openai" },
      { model: { id: "model-b" }, providerName: "p1", providerType: "openai" },
    ];
    if (endpoint === "/token-plan") return [
      { model: { id: "plan-model" }, providerName: "p2", providerType: "anthropic" },
    ];
    return [];
  };

  it("uses raw endpoint strings as keys in endpointModels (not labels)", () => {
    const result = buildPlaygroundConfig({
      getEndpoints: () => ["", "/token-plan"],
      getAllModels: mockGetAllModels,
      playgroundToken: "test-token-123",
    });

    expect(result.endpointModels).toEqual({
      "": ["model-a", "model-b"],
      "/token-plan": ["plan-model"],
    });
  });

  it("returns endpoints as a plain string array (not objects with prefix/label)", () => {
    const result = buildPlaygroundConfig({
      getEndpoints: () => ["", "/token-plan", "/custom-endpoint"],
      getAllModels: () => [],
      playgroundToken: "test-token-456",
    });

    expect(result.endpoints).toEqual(["", "/token-plan", "/custom-endpoint"]);
  });

  it("includes playgroundToken in config", () => {
    const result = buildPlaygroundConfig({
      getEndpoints: () => [],
      getAllModels: () => [],
      playgroundToken: "my-playground-token",
    });

    expect(result.playgroundToken).toBe("my-playground-token");
  });

  it("includes featureSuffixes in config", () => {
    const result = buildPlaygroundConfig({
      getEndpoints: () => [],
      getAllModels: () => [],
      playgroundToken: "token",
    });

    expect(result.featureSuffixes).toEqual({
      thinking: "-thinking",
      search: "-search",
      json: "-json",
    });
  });

  it("includes debugAccessible in config (defaults to false)", () => {
    const result = buildPlaygroundConfig({
      getEndpoints: () => [],
      getAllModels: () => [],
      playgroundToken: "token",
    });

    expect(result.debugAccessible).toBe(false);
  });
});

describe("createApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["NODE_ENV"] = "production";
  });

  it("calls getStorageAsync before mounting monitor routes", async () => {
    const { createApp } = await import("../server");

    expect(mockGetStorageAsync).not.toHaveBeenCalled();

    const app = await createApp();

    expect(mockGetStorageAsync).toHaveBeenCalledOnce();
    expect(app).toBeDefined();
  });
});

describe("authMiddleware on /v1/endpoints", () => {
  let server: http.Server;

  afterEach(() => {
    if (server) {
      server.close();
    }
    mockedConfig.proxyApiKey = undefined;
  });

  async function httpGet(
    path: string,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${path}`;
      const options: http.RequestOptions = {};
      if (headers) {
        options.headers = headers;
      }
      http
        .get(url, options, (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            let parsed: any;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
            resolve({ status: res.statusCode!, body: parsed });
          });
        })
        .on("error", reject);
    });
  }

  it("returns 401 when proxyApiKey is set and no API key is provided", async () => {
    mockedConfig.proxyApiKey = "test-api-key";

    const { createApp } = await import("../server");
    const app = await createApp();

    server = app.listen(0);

    const res = await httpGet("/v1/endpoints");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("missing_api_key");
  });

  it("returns 200 when proxyApiKey is set and correct API key is provided", async () => {
    mockedConfig.proxyApiKey = "test-api-key";

    const { createApp } = await import("../server");
    const app = await createApp();

    server = app.listen(0);

    const res = await httpGet("/v1/endpoints", {
      Authorization: "Bearer test-api-key",
    });

    expect(res.status).toBe(200);
  });
});

describe("health endpoint", () => {
  let server: http.Server;

  afterEach(() => {
    if (server) {
      server.close();
    }
  });

  it("does not expose auth configuration status", async () => {
    mockedConfig.proxyApiKey = undefined;

    const { createApp } = await import("../server");
    const app = await createApp();

    server = app.listen(0);

    const res = await new Promise<{ status: number; body: any }>(
      (resolve, reject) => {
        const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/health`;
        http
          .get(url, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => {
              data += chunk.toString();
            });
            res.on("end", () => {
              let parsed: any;
              try {
                parsed = JSON.parse(data);
              } catch {
                parsed = data;
              }
              resolve({ status: res.statusCode!, body: parsed });
            });
          })
          .on("error", reject);
      },
    );

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("auth");
    expect(res.body).toHaveProperty("status", "ok");
  });
});

describe("CORS middleware skips /debug and /monitor", () => {
  let server: http.Server;

  afterEach(() => {
    if (server) {
      server.close();
    }
  });

  async function httpGetHeaders(path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${path}`;
      http.get(url, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          resolve({ status: res.statusCode!, headers: res.headers });
        });
      }).on("error", reject);
    });
  }

  it("does not set CORS headers for /debug", async () => {
    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetHeaders("/debug");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not set CORS headers for /Debug (case insensitive)", async () => {
    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetHeaders("/Debug");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not set CORS headers for /debug/something", async () => {
    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetHeaders("/debug/something");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not set CORS headers for /monitor", async () => {
    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetHeaders("/monitor");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not set CORS headers for /MONITOR (case insensitive)", async () => {
    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetHeaders("/MONITOR");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not set CORS headers for /monitor/something", async () => {
    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetHeaders("/monitor/something");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("still sets CORS headers for normal paths like /health", async () => {
    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetHeaders("/health");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("still sets CORS headers for /debugger (not a /debug prefix)", async () => {
    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetHeaders("/debugger");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});

describe("localhostGuard on /debug routes", () => {
  let server: http.Server;

  afterEach(() => {
    if (server) {
      server.close();
    }
    mockedConfig.debug.enabled = false;
    mockLocalhostGuard.mockClear();
  });

  async function httpGet(path: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${path}`;
      http.get(url, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode!, body: parsed });
        });
      }).on("error", reject);
    });
  }

  it("applies localhostGuard to /debug when debug is enabled", async () => {
    mockedConfig.debug.enabled = true;

    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    await httpGet("/debug");
    expect(mockLocalhostGuard).toHaveBeenCalled();
  });

  it("applies localhostGuard to /debug/foo when debug is enabled", async () => {
    mockedConfig.debug.enabled = true;

    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    await httpGet("/debug/foo");
    expect(mockLocalhostGuard).toHaveBeenCalled();
  });

  it("does not apply localhostGuard when debug is disabled", async () => {
    mockedConfig.debug.enabled = false;

    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    await httpGet("/debug");
    expect(mockLocalhostGuard).not.toHaveBeenCalled();
  });
});

describe("Root / route — Debug link server-side injection", () => {
  let server: http.Server;

  const minHtml = '<!DOCTYPE html><html><head></head><body><a class="nav-link" href="./debug/">Debug</a></body></html>';

  afterEach(() => {
    if (server) {
      server.close();
    }
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue("");
    mockedConfig.debug.enabled = false;
  });

  async function httpGetRoot(): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
      http.get(url, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode!, body: data }));
      }).on("error", reject);
    });
  }

  it("hides Debug link when debug is disabled", async () => {
    mockedConfig.debug.enabled = false;
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const pathStr = String(p);
      return pathStr.includes("public") && pathStr.endsWith("index.html");
    });
    vi.mocked(fs.readFileSync).mockReturnValue(minHtml);

    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetRoot();
    expect(res.status).toBe(200);
    expect(res.body).toContain("hidden");
  });

  it("shows Debug link when debug is enabled and request is local", async () => {
    mockedConfig.debug.enabled = true;
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const pathStr = String(p);
      return pathStr.includes("public") && pathStr.endsWith("index.html");
    });
    vi.mocked(fs.readFileSync).mockReturnValue(minHtml);

    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetRoot();
    expect(res.status).toBe(200);
    expect(res.body).not.toContain("hidden");
  });
});

describe("Playground — debugAccessible injection", () => {
  let server: http.Server;

  const minPlaygroundHtml = '<!DOCTYPE html><html><head></head><body><a class="nav-link" href="/debug/" id="nav-debug">Debug</a></body></html>';

  afterEach(() => {
    if (server) {
      server.close();
    }
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue("");
    mockedConfig.debug.enabled = false;
  });

  async function httpGetPlayground(): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/playground`;
      http.get(url, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode!, body: data }));
      }).on("error", reject);
    });
  }

  it("injects debugAccessible:false when debug is disabled", async () => {
    mockedConfig.debug.enabled = false;
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const pathStr = String(p);
      return pathStr.includes("playground") && pathStr.endsWith("index.html");
    });
    vi.mocked(fs.readFileSync).mockReturnValue(minPlaygroundHtml);

    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetPlayground();
    expect(res.status).toBe(200);
    expect(res.body).toContain('"debugAccessible":false');
  });

  it("injects debugAccessible:true when debug is enabled and request is local", async () => {
    mockedConfig.debug.enabled = true;
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const pathStr = String(p);
      return pathStr.includes("playground") && pathStr.endsWith("index.html");
    });
    vi.mocked(fs.readFileSync).mockReturnValue(minPlaygroundHtml);

    const { createApp } = await import("../server");
    const app = await createApp();
    server = app.listen(0);

    const res = await httpGetPlayground();
    expect(res.status).toBe(200);
    expect(res.body).toContain('"debugAccessible":true');
  });
});
