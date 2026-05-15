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
    proxyApiKey: "",
    opsPassword: "test",
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
    it("should have 8 writable keys", () => {
      expect(OpsConfigManager.WRITABLE_KEYS.size).toBe(8);
    });

    it("should include all expected keys", () => {
      const expected = [
        "LOG_LEVEL",
        "MONITOR_FLUSH_INTERVAL_MS",
        "MONITOR_RETENTION_DAYS",
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
      const cfg = OpsConfigManager.getCurrentConfig();
      expect(cfg.logLevel).toBe("info");
      expect(cfg.monitorRetentionDays).toBe(30);
      expect(cfg.debugMaxRecords).toBe(500);
      expect(cfg.sensitive).toBeDefined();
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

    it("should accept valid MONITOR_FLUSH_INTERVAL_MS (>= 50)", () => {
      const result = OpsConfigManager.updateConfig({ monitorFlushIntervalMs: 100 });
      expect(result.success).toBe(true);
    });

    it("should reject MONITOR_FLUSH_INTERVAL_MS < 50", () => {
      const result = OpsConfigManager.updateConfig({ monitorFlushIntervalMs: 10 });
      expect(result.success).toBe(false);
      expect(result.error).toContain("MONITOR_FLUSH_INTERVAL_MS must be a number >= 50");
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

    it("should truncate float values for number fields", () => {
      const result = OpsConfigManager.updateConfig({ monitorFlushIntervalMs: 150.7 });
      expect(result.success).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("MONITOR_FLUSH_INTERVAL_MS=150"),
        "utf-8"
      );
    });
  });
});
