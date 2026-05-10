import { describe, it, expect, vi } from "vitest";

vi.mock("../../config", () => ({
  config: {
    upstream: {
      enabledModels: ["mimo-v2.5-pro", "mimo-v2-flash", "mimo-v2-omni"],
    },
  },
}));

// Re-import after mock — need fresh module
import { VIRTUAL_MODELS, findVirtualModel } from "../presets";

describe("VirtualModel token limits", () => {
  it("assigns correct limits for mimo-v2.5-pro", () => {
    const model = findVirtualModel("mimo-v2.5-pro");
    expect(model).toBeDefined();
    expect(model!.contextLength).toBe(1_000_000);
    expect(model!.maxOutputTokens).toBe(128_000);
  });

  it("assigns correct limits for mimo-v2-flash", () => {
    const model = findVirtualModel("mimo-v2-flash");
    expect(model).toBeDefined();
    expect(model!.contextLength).toBe(256_000);
    expect(model!.maxOutputTokens).toBe(64_000);
  });

  it("assigns correct limits for mimo-v2-omni", () => {
    const model = findVirtualModel("mimo-v2-omni");
    expect(model).toBeDefined();
    expect(model!.contextLength).toBe(256_000);
    expect(model!.maxOutputTokens).toBe(128_000);
  });

  it("inherits upstream token limits for suffixed variants", () => {
    const thinking = findVirtualModel("mimo-v2.5-pro-thinking");
    expect(thinking).toBeDefined();
    expect(thinking!.contextLength).toBe(1_000_000);
    expect(thinking!.maxOutputTokens).toBe(128_000);
  });

  it("generates correct number of models", () => {
    // 3 upstream models x 8 feature presets = 24
    expect(VIRTUAL_MODELS).toHaveLength(24);
  });
});
