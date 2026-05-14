import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExistsSync = vi.fn().mockReturnValue(true);
const mockReadFileSync = vi.fn().mockReturnValue("LOG_LEVEL=info\n");
const mockWriteFileSync = vi.fn();

vi.mock("fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  },
}));

vi.mock("../../config", () => ({
  config: {
    mimoApiKey: "",
    proxyApiKey: "",
    opsPassword: "test",
    server: { port: 3000, host: "0.0.0.0", maxBodySize: "10mb" },
    upstream: {
      baseUrl: "https://api.xiaomimimo.com",
      anthropicBaseUrl: "https://api.xiaomimimo.com/anthropic",
      enabledModels: ["mimo-v2-flash"],
      defaultModel: "mimo-v2-flash",
      timeout: 120_000,
    },
    webSearch: {
      maxKeyword: 3,
      forceSearch: true,
      limit: 3,
      userLocation: { type: "approximate", country: "China", region: "Beijing", city: "Beijing" },
    },
    monitor: {
      storage: "memory",
      sqlitePath: "./data/monitor.db",
      retentionDays: 30,
      flushIntervalMs: 200,
      flushBatchSize: 100,
      queueMaxSize: 10_000,
    },
    tokenPlan: {
      enabled: false,
      proxyApiKey: "",
      mimoApiKey: "",
      baseUrl: "",
      anthropicBaseUrl: "",
      timeout: 120_000,
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

vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../debug/store", () => ({
  debugStore: {
    setMaxRecords: vi.fn(),
  },
}));

describe("OpsConfigManager", () => {
  let OpsConfigManager: typeof import("../configManager").OpsConfigManager;

  beforeEach(async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("LOG_LEVEL=info\n");
    mockWriteFileSync.mockClear();

    vi.stubGlobal("process", {
      ...process,
      cwd: () => "/tmp",
    });

    const mod = await import("../configManager");
    OpsConfigManager = mod.OpsConfigManager;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe("WRITABLE_KEYS", () => {
    it("should have 15 writable keys", () => {
      expect(OpsConfigManager.WRITABLE_KEYS.size).toBe(15);
    });

    it("should include all expected keys", () => {
      const expected = [
        "LOG_LEVEL",
        "WEB_SEARCH_MAX_KEYWORD",
        "WEB_SEARCH_FORCE_SEARCH",
        "WEB_SEARCH_LIMIT",
        "WEB_SEARCH_COUNTRY",
        "WEB_SEARCH_REGION",
        "WEB_SEARCH_CITY",
        "MONITOR_FLUSH_INTERVAL_MS",
        "MONITOR_RETENTION_DAYS",
        "UPSTREAM_TIMEOUT_MS",
        "MONITOR_FLUSH_BATCH_SIZE",
        "MONITOR_QUEUE_MAX_SIZE",
        "DEBUG_MAX_RECORDS",
        "DEBUG_MAX_BODY_SIZE",
        "DEBUG_MAX_MEDIA_BYTES",
      ];
      for (const key of expected) {
        expect(OpsConfigManager.WRITABLE_KEYS.has(key)).toBe(true);
      }
    });
  });

  describe("getCurrentConfig", () => {
    it("should return config with all expected fields", () => {
      const config = OpsConfigManager.getCurrentConfig();
      expect(config.logLevel).toBe("info");
      expect(config.webSearchMaxKeyword).toBe(3);
      expect(config.webSearchForceSearch).toBe(false);
      expect(config.monitorRetentionDays).toBe(30);
      expect(config.upstreamTimeoutMs).toBe(120_000);
      expect(config.debugMaxRecords).toBe(500);
      expect(config.sensitive).toBeDefined();
    });
  });

  describe("updateConfig - validation", () => {
    it("should reject unknown key", () => {
      const result = OpsConfigManager.updateConfig({ unknownKey: "value" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not allowed");
    });

    it("should accept valid LOG_LEVEL", () => {
      const result = OpsConfigManager.updateConfig({ logLevel: "debug" });
      expect(result.success).toBe(true);
    });

    it("should reject invalid LOG_LEVEL", () => {
      const result = OpsConfigManager.updateConfig({ logLevel: "invalid" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("LOG_LEVEL must be one of");
    });

    it("should accept valid WEB_SEARCH_MAX_KEYWORD", () => {
      const result = OpsConfigManager.updateConfig({ webSearchMaxKeyword: 5 });
      expect(result.success).toBe(true);
    });

    it("should reject WEB_SEARCH_MAX_KEYWORD < 1", () => {
      const result = OpsConfigManager.updateConfig({ webSearchMaxKeyword: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toContain("WEB_SEARCH_MAX_KEYWORD must be a positive number");
    });

    it("should reject non-number WEB_SEARCH_MAX_KEYWORD", () => {
      const result = OpsConfigManager.updateConfig({ webSearchMaxKeyword: "abc" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("WEB_SEARCH_MAX_KEYWORD must be a positive number");
    });

    it("should accept valid boolean for WEB_SEARCH_FORCE_SEARCH", () => {
      const result = OpsConfigManager.updateConfig({ webSearchForceSearch: false });
      expect(result.success).toBe(true);
    });

    it("should reject non-boolean for WEB_SEARCH_FORCE_SEARCH", () => {
      const result = OpsConfigManager.updateConfig({ webSearchForceSearch: "yes" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("WEB_SEARCH_FORCE_SEARCH must be a boolean");
    });

    it("should accept valid MONITOR_FLUSH_INTERVAL_MS (>= 50)", () => {
      const result = OpsConfigManager.updateConfig({ monitorFlushIntervalMs: 100 });
      expect(result.success).toBe(true);
    });

    it("should reject MONITOR_FLUSH_INTERVAL_MS < 50", () => {
      const result = OpsConfigManager.updateConfig({ monitorFlushIntervalMs: 10 });
      expect(result.success).toBe(false);
      expect(result.error).toContain("MONITOR_FLUSH_INTERVAL_MS must be a number >= 50");
    });

    it("should accept valid UPSTREAM_TIMEOUT_MS (>= 1000)", () => {
      const result = OpsConfigManager.updateConfig({ upstreamTimeoutMs: 5000 });
      expect(result.success).toBe(true);
    });

    it("should reject UPSTREAM_TIMEOUT_MS < 1000", () => {
      const result = OpsConfigManager.updateConfig({ upstreamTimeoutMs: 500 });
      expect(result.success).toBe(false);
      expect(result.error).toContain("UPSTREAM_TIMEOUT_MS must be a number >= 1000");
    });

    it("should accept valid DEBUG_MAX_BODY_SIZE (>= 1024)", () => {
      const result = OpsConfigManager.updateConfig({ debugMaxBodySize: 2048 });
      expect(result.success).toBe(true);
    });

    it("should reject DEBUG_MAX_BODY_SIZE < 1024", () => {
      const result = OpsConfigManager.updateConfig({ debugMaxBodySize: 512 });
      expect(result.success).toBe(false);
      expect(result.error).toContain("DEBUG_MAX_BODY_SIZE must be a number >= 1024");
    });

    it("should accept valid DEBUG_MAX_MEDIA_BYTES (>= 1024)", () => {
      const result = OpsConfigManager.updateConfig({ debugMaxMediaBytes: 2048 });
      expect(result.success).toBe(true);
    });

    it("should reject DEBUG_MAX_MEDIA_BYTES < 1024", () => {
      const result = OpsConfigManager.updateConfig({ debugMaxMediaBytes: 100 });
      expect(result.success).toBe(false);
      expect(result.error).toContain("DEBUG_MAX_MEDIA_BYTES must be a number >= 1024");
    });

    it("should accept non-empty string for WEB_SEARCH_COUNTRY", () => {
      const result = OpsConfigManager.updateConfig({ webSearchCountry: "US" });
      expect(result.success).toBe(true);
    });

    it("should reject empty string for WEB_SEARCH_COUNTRY", () => {
      const result = OpsConfigManager.updateConfig({ webSearchCountry: "" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("WEB_SEARCH_COUNTRY must be a non-empty string");
    });

    it("should truncate float values for number fields", () => {
      const result = OpsConfigManager.updateConfig({ webSearchMaxKeyword: 3.7 });
      expect(result.success).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("WEB_SEARCH_MAX_KEYWORD=3"),
        "utf-8"
      );
    });
  });
});
