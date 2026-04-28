import { describe, it, expect, beforeEach, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import { createTokenPlanRouter } from "../server";

// Mock config
vi.mock("../../config", () => ({
  config: {
    tokenPlan: {
      enabled: true,
      proxyApiKey: "test-proxy-key",
      mimoApiKey: "test-mimo-key",
      baseUrl: "https://token-plan-cn.xiaomimimo.com",
      anthropicBaseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
      timeout: 30_000,
    },
    mimoApiKey: "fallback-key",
    debug: {
      enabled: false,
      maxRecords: 500,
      maxBodySize: 1_048_576,
    },
    upstream: {
      defaultModel: "mimo-v2-flash",
    },
  },
}));

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: "/v1/chat/completions",
    method: "POST",
    originalUrl: "/token-plan/v1/chat/completions",
    body: { model: "test", messages: [{ role: "user", content: "hi" }] },
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response & { _responseData?: any; _statusCode?: number } {
  const res: any = {
    statusCode: 200,
    locals: {},
    headersSent: false,
    _responseData: undefined,
    _statusCode: 200,
    status(code: number) {
      res._statusCode = code;
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      res._responseData = body;
      res.headersSent = true;
      return res;
    },
    sendStatus(code: number) {
      res._statusCode = code;
      res.statusCode = code;
      res.headersSent = true;
      return res;
    },
    setHeader: vi.fn(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn().mockImplementation(() => {
      res.headersSent = true;
      return res;
    }),
  };
  return res as unknown as Response & { _responseData?: any; _statusCode?: number };
}

describe("createTokenPlanRouter", () => {
  it("should return an express Router", () => {
    const router = createTokenPlanRouter();
    expect(router).toBeDefined();
    expect(typeof router).toBe("function");
  });

  it("should have router stack with routes", () => {
    const router = createTokenPlanRouter();
    // Router should have route entries
    const stack = (router as any).stack;
    expect(stack).toBeDefined();
    expect(stack.length).toBeGreaterThan(0);
  });
});