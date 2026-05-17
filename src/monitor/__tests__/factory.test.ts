import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { mockSetStorage } = vi.hoisted(() => ({
  mockSetStorage: vi.fn(),
}));

vi.mock("../storage/worker", () => ({
  storageWorker: {
    setStorage: mockSetStorage,
    append: vi.fn(),
  },
}));

vi.mock("../storage/sqlite", () => ({
  SqliteStorage: {
    initSqlModule: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("getStorage - SQLite path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("calls storageWorker.setStorage(memoryStorage) immediately when SQLite is configured", async () => {
    vi.doMock("../../config", () => ({
      config: {
        monitor: {
          storage: "sqlite",
          sqlitePath: ":memory:",
          flushIntervalMs: 5000,
          flushBatchSize: 10,
          queueMaxSize: 1000,
        },
      },
    }));

    const { getStorage } = await import("../storage/factory");
    const { memoryStorage } = await import("../storage");
    const storage = getStorage();

    expect(storage).toBeDefined();
    expect(mockSetStorage).toHaveBeenCalled();
    expect(mockSetStorage).toHaveBeenCalledWith(memoryStorage);
  });
});
