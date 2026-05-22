import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Request, Response, NextFunction } from "express";

const { mockedExtractApiKey, mockedConfig } = vi.hoisted(() => ({
  mockedExtractApiKey: vi.fn(),
  mockedConfig: {
    proxyApiKey: "" as string | undefined,
  },
}));

vi.mock("../../utils/auth", () => ({
  extractApiKey: mockedExtractApiKey,
}));

vi.mock("../../config", () => ({
  config: mockedConfig,
}));

import { authMiddleware } from "../auth";

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe("authMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedConfig.proxyApiKey = "";
  });

  it("calls next() when proxyApiKey is not set", () => {
    mockedConfig.proxyApiKey = "";
    const req = {} as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 with missing_api_key when proxyApiKey is set and no key provided", () => {
    mockedConfig.proxyApiKey = "secret-key";
    mockedExtractApiKey.mockReturnValue(null);

    const req = {} as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message:
          "Missing API key. Provide it via 'Authorization: Bearer <key>', 'api-key: <key>' or 'x-api-key: <key>' header.",
        type: "authentication_error",
        code: "missing_api_key",
      },
    });
  });

  it("returns 401 with invalid_api_key when proxyApiKey is set and wrong key provided", () => {
    mockedConfig.proxyApiKey = "secret-key";
    mockedExtractApiKey.mockReturnValue("wrong-key");

    const req = {} as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "Invalid API key.",
        type: "authentication_error",
        code: "invalid_api_key",
      },
    });
  });

  it("calls next() when proxyApiKey is set and correct key provided", () => {
    mockedConfig.proxyApiKey = "secret-key";
    mockedExtractApiKey.mockReturnValue("secret-key");

    const req = {} as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
