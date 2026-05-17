import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetStorageAsync, mockGetStorage } = vi.hoisted(() => ({
  mockGetStorageAsync: vi.fn().mockResolvedValue({} as any),
  mockGetStorage: vi.fn(() => ({ prune: vi.fn() }) as any),
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
    getEndpoints: () => [],
    getProviders: () => [],
    getAllModels: () => [],
  },
}));

vi.mock("../monitor/index", () => ({
  monitorRouter: vi.fn(),
  monitorMiddleware: vi.fn(),
}));

vi.mock("../monitor/pricing", () => ({
  registerProviderPricing: vi.fn(),
}));

vi.mock("../ops/index", () => ({
  opsRouter: vi.fn(),
}));

vi.mock("../routes/chat", () => ({
  chatRouter: vi.fn(),
}));

vi.mock("../routes/anthropic", () => ({
  anthropicRouter: vi.fn(),
}));

vi.mock("../routes/models", () => ({
  modelsRouter: vi.fn(),
}));

vi.mock("../utils/auth", () => ({
  extractApiKey: vi.fn(),
}));

vi.mock("../debug", () => ({
  debugMiddleware: vi.fn(),
  debugRouter: vi.fn(),
}));

vi.mock("../config", () => ({
  config: {
    configDir: "/test/config",
    proxyApiKey: undefined,
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
