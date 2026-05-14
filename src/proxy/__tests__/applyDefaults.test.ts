import { describe, it, expect } from "vitest";
import { applyDefaults } from "../applyDefaults";

describe("applyDefaults", () => {
  it("applies defaults for keys absent from original body", () => {
    const body = { model: "test" };
    const defaults = { temperature: 0.5, thinking: { type: "enabled" } };
    const original = { model: "test" };
    const result = applyDefaults(body, defaults, original);
    expect(result["temperature"]).toBe(0.5);
    expect(result["thinking"]).toEqual({ type: "enabled" });
  });

  it("does not overwrite client-provided values", () => {
    const body = { model: "test", temperature: 0.8 };
    const defaults = { temperature: 0.5 };
    const original = { model: "test", temperature: 0.8 };
    const result = applyDefaults(body, defaults, original);
    expect(result["temperature"]).toBe(0.8);
  });

  it("returns body unchanged when defaults is undefined", () => {
    const body = { model: "test" };
    const result = applyDefaults(body, undefined, body);
    expect(result).toBe(body);
  });

  it("handles empty defaults", () => {
    const body = { model: "test" };
    const result = applyDefaults(body, {}, body);
    expect(result).toBe(body);
  });
});
