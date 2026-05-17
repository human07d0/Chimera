import { EventEmitter } from "events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process.spawn — hoisting-safe: use vi.fn() inside the factory
const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

class MockChildProcess extends EventEmitter {
  killed = false;
  connected = false;
  unref = vi.fn();
}

vi.mock("child_process", () => ({
  spawn: mockSpawn,
}));

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn() },
}));

vi.useFakeTimers();

import { performDirectRestart } from "../watcher";
import { logger } from "../../utils/logger";

describe("performDirectRestart", () => {
  // Module-level to survive the fake timer interplay across all tests
  let exitSpy: any;

  beforeEach(() => {
    mockSpawn.mockClear();
    vi.mocked(logger.info).mockClear();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      // no-op: prevent actual process exit during tests
    }) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("spawns new process with stdio 'ignore' not 'inherit'", () => {
    const child = new MockChildProcess();
    mockSpawn.mockReturnValue(child);

    performDirectRestart();
    vi.advanceTimersByTime(1600);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnOptions = mockSpawn.mock.calls[0]?.[2];
    // Must NOT use "inherit" which ties child I/O to parent on Windows
    expect(spawnOptions.stdio).toBe("ignore");
  });

  it("exits only after the child emits 'spawn'", () => {
    const child = new MockChildProcess();
    mockSpawn.mockReturnValue(child);

    performDirectRestart();
    vi.advanceTimersByTime(1600);

    // Exit should NOT have been called yet — 'spawn' hasn't fired
    expect(exitSpy).not.toHaveBeenCalled();

    // Emit 'spawn' — this triggers the exit
    child.emit("spawn");

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("calls child.unref() before exit on spawn", () => {
    const child = new MockChildProcess();
    mockSpawn.mockReturnValue(child);

    performDirectRestart();
    vi.advanceTimersByTime(1600);

    child.emit("spawn");

    expect(child.unref).toHaveBeenCalledBefore(exitSpy as any);
  });

  it("exits with code 1 on 'error' event to avoid hanging forever", () => {
    const child = new MockChildProcess();
    mockSpawn.mockReturnValue(child);

    performDirectRestart();
    vi.advanceTimersByTime(1600);

    child.emit("error", new Error("ENOENT"));

    // On spawn failure, exit with code 1 so the process doesn't hang
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs 'Performing direct restart...' when invoked", () => {
    const child = new MockChildProcess();
    mockSpawn.mockReturnValue(child);

    performDirectRestart();
    vi.advanceTimersByTime(1600);

    expect(logger.info).toHaveBeenCalledWith("Performing direct restart...");
  });
});
