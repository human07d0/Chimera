import { describe, it, expect } from "vitest";
import { extractEndpointPrefix } from "../endpointPrefix";
import type { Request } from "express";

function mockReq(baseUrl: string): Request {
  return { baseUrl } as unknown as Request;
}

describe("extractEndpointPrefix", () => {
  describe("normal routes", () => {
    it('returns "" for baseUrl "/v1" (no prefix)', () => {
      expect(extractEndpointPrefix(mockReq("/v1"))).toBe("");
    });

    it('returns "/token-plan" for baseUrl "/token-plan/v1"', () => {
      expect(extractEndpointPrefix(mockReq("/token-plan/v1"))).toBe("/token-plan");
    });

    it('returns "/token-plan" for baseUrl "/token-plan/anthropic/v1"', () => {
      expect(extractEndpointPrefix(mockReq("/token-plan/anthropic/v1"))).toBe("/token-plan");
    });
  });

  describe("playground routes", () => {
    it('returns "" for baseUrl "/playground/api/v1"', () => {
      expect(extractEndpointPrefix(mockReq("/playground/api/v1"))).toBe("");
    });

    it('returns "/token-plan" for baseUrl "/playground/api/token-plan/v1"', () => {
      expect(extractEndpointPrefix(mockReq("/playground/api/token-plan/v1"))).toBe("/token-plan");
    });

    it('returns "" for baseUrl "/playground/api/anthropic/v1"', () => {
      expect(extractEndpointPrefix(mockReq("/playground/api/anthropic/v1"))).toBe("");
    });

    it('returns "/token-plan" for baseUrl "/playground/api/token-plan/anthropic/v1"', () => {
      expect(extractEndpointPrefix(mockReq("/playground/api/token-plan/anthropic/v1"))).toBe("/token-plan");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for no-match baseUrl", () => {
      expect(extractEndpointPrefix(mockReq("/unknown"))).toBe("");
    });

    it("returns empty string for empty baseUrl", () => {
      expect(extractEndpointPrefix(mockReq(""))).toBe("");
    });

    it("returns prefix for nested custom endpoint", () => {
      expect(extractEndpointPrefix(mockReq("/custom/path/v1"))).toBe("/custom/path");
    });

    it('returns empty string for trailing slash', () => {
      expect(extractEndpointPrefix(mockReq("/token-plan/v1/"))).toBe("");
    });
  });
});
