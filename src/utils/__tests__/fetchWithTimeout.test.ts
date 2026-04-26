import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithTimeout } from "../fetchWithTimeout";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Clear any global.fetch we set
    try {
      delete (globalThis as any).fetch;
    } catch {}
  });

  it("resolves when fetch resolves", async () => {
    const response = { ok: true } as any;
    (globalThis as any).fetch = vi.fn(() => Promise.resolve(response));
    const res = await fetchWithTimeout("http://example", {}, 1000);
    expect(res).toBe(response);
  });

  it("throws timeout error when fetch is aborted", async () => {
    (globalThis as any).fetch = vi.fn((url: string, { signal }: any) =>
      new Promise((_resolve, reject) => {
        if (signal && typeof signal.addEventListener === "function") {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }
      })
    );

    await expect(fetchWithTimeout("http://example", {}, 10)).rejects.toThrow(/timed out/);
  });

  it("propagates underlying fetch errors", async () => {
    (globalThis as any).fetch = vi.fn(() => Promise.reject(new Error("network")));
    await expect(fetchWithTimeout("http://example", {}, 1000)).rejects.toThrow("network");
  });
});
