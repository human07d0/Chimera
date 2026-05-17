import { describe, it, expect, vi } from "vitest";
import * as http from "http";

const { mockReadFileSync, mockExistsSync, mockReaddirSync, noopHandler } = vi.hoisted(() => {
  const fns = {
    mockReadFileSync: vi.fn(),
    mockExistsSync: vi.fn(),
    mockReaddirSync: vi.fn(() => [] as string[]),
    noopHandler: (_req: unknown, _res: unknown, next?: () => void) => {
      if (next) next();
    },
  };
  return fns;
});

vi.mock("fs", () => ({
  default: {
    readFileSync: mockReadFileSync,
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
  },
}));

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../providers/registry", () => ({
  modelRegistry: {
    init: vi.fn(),
    getProviders: vi.fn(() => []),
    getEndpoints: vi.fn(() => []),
    getAllModels: vi.fn(() => []),
  },
}));

vi.mock("../monitor/pricing", () => ({
  registerProviderPricing: vi.fn(),
}));

vi.mock("../config", () => ({
  config: {
    configDir: "/fake",
    bodySizeLimit: () => "1mb",
    debug: { enabled: false },
    proxyApiKey: undefined as string | undefined,
    logLevel: "info",
  },
}));

vi.mock("../monitor", () => ({
  monitorRouter: noopHandler,
  monitorMiddleware: noopHandler,
}));

vi.mock("../monitor/storage/factory", () => ({
  getStorage: vi.fn(() => ({
    queue: vi.fn(),
    flush: vi.fn(),
    getMetrics: vi.fn(),
  })),
  getStorageAsync: vi.fn(() => Promise.resolve({
    queue: vi.fn(),
    flush: vi.fn(),
    getMetrics: vi.fn(),
  })),
}));

vi.mock("../ops/index", () => ({
  opsRouter: noopHandler,
}));

vi.mock("../debug", () => ({
  debugMiddleware: noopHandler,
  debugRouter: noopHandler,
}));

vi.mock("../routes/chat", () => ({
  chatRouter: noopHandler,
}));

vi.mock("../routes/anthropic", () => ({
  anthropicRouter: noopHandler,
}));

vi.mock("../routes/models", () => ({
  modelsRouter: noopHandler,
}));

vi.mock("../utils/auth", () => ({
  extractApiKey: vi.fn(() => undefined),
}));

import { createApp } from "../server";

function makeRequest(
  app: ReturnType<typeof createApp> extends Promise<infer T> ? T : never,
  path: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        return reject(new Error("Could not get server address"));
      }
      const port = addr.port;
      const req = http.request(
        { hostname: "127.0.0.1", port, path, method: "GET" },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => (body += chunk.toString()));
          res.on("end", () => {
            server.close();
            resolve({ statusCode: res.statusCode ?? 0, body });
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

describe("Playground HTML template caching", () => {
  it("reads the template from disk only once across multiple requests", async () => {
    const htmlTemplate = "<!DOCTYPE html><html><head></head><body>PLAYGROUND</body></html>";

    mockReadFileSync.mockReturnValue(htmlTemplate);
    mockExistsSync.mockImplementation((p: string) => {
      if (typeof p === "string" && p.includes("playground") && p.endsWith("index.html")) {
        return true;
      }
      return false;
    });

    process.env["NODE_ENV"] = "production";

    const app = await createApp();

    const res1 = await makeRequest(app, "/playground");
    expect(res1.statusCode).toBe(200);

    const res2 = await makeRequest(app, "/playground");
    expect(res2.statusCode).toBe(200);

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });
});
