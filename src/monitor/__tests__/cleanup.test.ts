import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrune } = vi.hoisted(() => ({
  mockPrune: vi.fn().mockReturnValue(5),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../storage/factory", () => ({
  getStorage: vi.fn(() => ({ prune: mockPrune })),
}));

describe("cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    vi.doMock("../../config", () => ({
      config: {
        monitor: {
          retentionDays: 30,
        },
      },
    }));
  });

  it("startCleanupTask immediately runs prune with configured retention days", async () => {
    const { startCleanupTask } = await import("../cleanup");

    startCleanupTask();

    expect(mockPrune).toHaveBeenCalledWith(30);
  });

  it("startCleanupTask does not throw when prune fails", async () => {
    mockPrune.mockImplementation(() => {
      throw new Error("prune failed");
    });

    const { startCleanupTask } = await import("../cleanup");

    expect(() => startCleanupTask()).not.toThrow();
  });

  it("stopCleanupTask is a no-op when no interval is active", async () => {
    const { stopCleanupTask } = await import("../cleanup");

    expect(() => stopCleanupTask()).not.toThrow();
  });

  it("startCleanupTask schedules a daily interval", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const { startCleanupTask } = await import("../cleanup");

    startCleanupTask();

    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      24 * 60 * 60 * 1000,
    );

    vi.useRealTimers();
  });

  it("stopCleanupTask clears the interval after startCleanupTask", async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");

    const { startCleanupTask, stopCleanupTask } = await import("../cleanup");

    startCleanupTask();

    stopCleanupTask();

    expect(clearIntervalSpy).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
