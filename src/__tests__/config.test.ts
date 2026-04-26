import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_UPSTREAM_MODELS, requireEnv } from "../config";

describe("config module", () => {
  beforeEach(() => {
    vi.resetModules();
    // Set to empty string instead of deleting, so dotenv/config won't re-populate from .env
    [
      "PORT",
      "HOST",
      "MIMO_ENABLED_MODELS",
      "MIMO_API_KEY",
      "MONITOR_RETENTION_DAYS",
      "MONITOR_FLUSH_INTERVAL_MS",
      "MONITOR_FLUSH_BATCH_SIZE",
      "MONITOR_QUEUE_MAX_SIZE",
      "MONITOR_STORAGE",
      "DEBUG_ENABLED",
      "TOKEN_PLAN_ENABLED",
    ].forEach((k) => { process.env[k] = ""; });
  });

  it("loads sensible defaults", async () => {
    const { config } = await import("../config");
    expect(config.server.port).toBe(3000);
    expect(config.server.host).toBe("0.0.0.0");
    expect(config.upstream.baseUrl).toBe("https://api.xiaomimimo.com");
    expect(config.upstream.enabledModels).toEqual([...SUPPORTED_UPSTREAM_MODELS]);
    expect(config.tokenPlan.enabled).toBe(false);
    expect(config.debug.enabled).toBe(false);
  });

  it("applies environment overrides", async () => {
    process.env.PORT = "4001";
    process.env.HOST = "127.0.0.1";
    process.env.MIMO_API_KEY = "abc123";
    process.env.MIMO_ENABLED_MODELS = "mimo-v2-pro,mimo-v2.5";
    process.env.MONITOR_STORAGE = "sqlite";
    process.env.DEBUG_ENABLED = "true";
    vi.resetModules();
    const { config } = await import("../config");
    expect(config.server.port).toBe(4001);
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.mimoApiKey).toBe("abc123");
    expect(config.upstream.enabledModels).toEqual(["mimo-v2-pro", "mimo-v2.5"]);
    expect(config.monitor.storage).toBe("sqlite");
    expect(config.debug.enabled).toBe(true);
  });

  it("invalid monitor values fallback to defaults and warn", async () => {
    process.env.MONITOR_RETENTION_DAYS = "0";
    process.env.MONITOR_FLUSH_INTERVAL_MS = "10";
    process.env.MONITOR_FLUSH_BATCH_SIZE = "0";
    process.env.MONITOR_QUEUE_MAX_SIZE = "-1";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const { config } = await import("../config");
    expect(config.monitor.retentionDays).toBe(30);
    expect(config.monitor.flushIntervalMs).toBe(200);
    expect(config.monitor.flushBatchSize).toBe(100);
    expect(config.monitor.queueMaxSize).toBe(10000);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("invalid MIMO_ENABLED_MODELS fall back to defaults and warn", async () => {
    process.env.MIMO_ENABLED_MODELS = "invalid1,invalid2";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const { config } = await import("../config");
    expect(config.upstream.enabledModels).toEqual([...SUPPORTED_UPSTREAM_MODELS]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("requireEnv", () => {
  it("returns value when environment variable exists", () => {
    process.env["TEST_REQUIRE_VAR"] = "hello";
    expect(requireEnv("TEST_REQUIRE_VAR")).toBe("hello");
    delete process.env["TEST_REQUIRE_VAR"];
  });

  it("throws Error when environment variable is missing", () => {
    delete process.env["MISSING_VAR"];
    expect(() => requireEnv("MISSING_VAR")).toThrowError(
      "Missing required environment variable: MISSING_VAR"
    );
  });

  it("throws Error when environment variable is empty string", () => {
    process.env["EMPTY_VAR"] = "";
    expect(() => requireEnv("EMPTY_VAR")).toThrowError(
      "Missing required environment variable: EMPTY_VAR"
    );
    delete process.env["EMPTY_VAR"];
  });
});
