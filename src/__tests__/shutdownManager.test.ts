import { beforeEach, describe, expect, it, vi } from "vitest";

const stopCleanupTask = vi.fn();
const storageShutdown = vi.fn(() => Promise.resolve());
const stopWatcher = vi.fn();
const performDirectRestart = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("../server", () => ({ stopCleanupTask }));
vi.mock("../monitor/storage/worker", () => ({ storageWorker: { shutdown: storageShutdown } }));
vi.mock("../ops", () => ({ stopWatcher, performDirectRestart }));
vi.mock("../utils/logger", () => ({ logger }));

describe("shutdownManager", () => {
  beforeEach(() => {
    vi.resetModules();
    stopCleanupTask.mockClear();
    storageShutdown.mockClear();
    stopWatcher.mockClear();
    performDirectRestart.mockClear();
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();
  });

  it("requestShutdown triggers graceful shutdown and exits", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {}) as any);

    const serverMock = { close: (cb: (err?: Error) => void) => cb() };

    const shutdown = await import("../shutdownManager");
    shutdown.setServer(serverMock as any);

    shutdown.requestShutdown();

    await new Promise((r) => setTimeout(r, 0));

    expect(storageShutdown).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
  });

  it("requestRestart triggers performDirectRestart after shutdown", async () => {
    const shutdown = await import("../shutdownManager");

    shutdown.requestRestart();

    await new Promise((r) => setTimeout(r, 0));

    expect(performDirectRestart).toHaveBeenCalled();
  });

  it("repeated calls are idempotent", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {}) as any);

    const serverMock = { close: (cb: (err?: Error) => void) => cb() };

    const shutdown = await import("../shutdownManager");
    shutdown.setServer(serverMock as any);

    shutdown.requestShutdown();
    shutdown.requestShutdown();

    await new Promise((r) => setTimeout(r, 0));

    expect(storageShutdown).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();

    exitSpy.mockRestore();
  });
});
