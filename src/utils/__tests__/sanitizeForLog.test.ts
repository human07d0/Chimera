import { describe, expect, it } from "vitest";
import { sanitizeForLog } from "../sanitizeForLog";

describe("sanitizeForLog", () => {
  it("returns non-object values as-is", () => {
    expect(sanitizeForLog("hello")).toBe("hello");
    expect(sanitizeForLog(42)).toBe(42);
    expect(sanitizeForLog(null)).toBe(null);
    expect(sanitizeForLog(undefined)).toBe(undefined);
  });

  it("keeps only error, message, code, type fields from objects", () => {
    const input = {
      error: "bad request",
      message: "invalid",
      code: 400,
      type: "validation",
      password: "secret",
      token: "abc123",
      nested: { deep: "value" },
    };
    const result = sanitizeForLog(input) as Record<string, unknown>;
    expect(result).toEqual({
      error: "bad request",
      message: "invalid",
      code: 400,
      type: "validation",
    });
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("token");
    expect(result).not.toHaveProperty("nested");
  });

  it("returns empty object for objects with no allowed fields", () => {
    expect(sanitizeForLog({ foo: "bar", baz: 1 })).toEqual({
      error: undefined,
      message: undefined,
      code: undefined,
      type: undefined,
    });
  });

  it("returns empty object for empty objects", () => {
    expect(sanitizeForLog({})).toEqual({
      error: undefined,
      message: undefined,
      code: undefined,
      type: undefined,
    });
  });
});