import { describe, it, expect } from "vitest";
import { Request } from "express";
import { extractApiKey } from "../auth";

describe("extractApiKey", () => {
  it("extracts Bearer token", () => {
    const req = { headers: { authorization: "Bearer abc" } } as unknown as Request;
    expect(extractApiKey(req)).toBe("abc");
  });

  it("extracts api-key header", () => {
    const req = { headers: { "api-key": "key1" } } as unknown as Request;
    expect(extractApiKey(req)).toBe("key1");
  });

  it("extracts x-api-key header", () => {
    const req = { headers: { "x-api-key": "key2" } } as unknown as Request;
    expect(extractApiKey(req)).toBe("key2");
  });

  it("returns null when missing", () => {
    const req = { headers: {} } as unknown as Request;
    expect(extractApiKey(req)).toBeNull();
  });
});
