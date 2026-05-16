import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Request, Response, NextFunction } from "express";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../pricing", () => ({
  calculateCost: vi.fn(() => 0.0042),
}));

vi.mock("../storage/worker", () => ({
  storageWorker: {
    append: vi.fn(),
  },
}));

import { monitorMiddleware } from "../middleware";
import { storageWorker } from "../storage/worker";
import { calculateCost } from "../pricing";

function createMockReq(path: string, body?: Record<string, unknown>): Request {
  return {
    path,
    originalUrl: `/v1${path}`,
    method: "POST",
    body: body || { model: "test-model" },
    headers: {},
  } as unknown as Request;
}

function createMockRes(path: string): Response {
  return {
    json: vi.fn().mockReturnThis(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn().mockReturnThis(),
    statusCode: 200,
    locals: {},
    setHeader: vi.fn(),
  } as unknown as Response;
}

describe("extractUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeros for null payload", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)(null);
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(0);
    expect(event.output_tokens).toBe(0);
    expect(event.cached_prompt_tokens).toBe(0);
  });

  it("returns zeros for undefined payload", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)(undefined);
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(0);
    expect(event.output_tokens).toBe(0);
  });

  it("returns zeros for non-object payload (string)", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)("just a string");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(0);
    expect(event.output_tokens).toBe(0);
  });

  it("returns zeros when usage field is missing", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({ choices: [] });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(0);
    expect(event.output_tokens).toBe(0);
  });

  it("extracts prompt_tokens and completion_tokens (OpenAI format)", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(100);
    expect(event.output_tokens).toBe(50);
  });

  it("extracts input_tokens and output_tokens (Anthropic format)", () => {
    const req = createMockReq("/messages");
    const res = createMockRes("/messages");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({
      usage: { input_tokens: 200, output_tokens: 80 },
    });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(200);
    expect(event.output_tokens).toBe(80);
  });

  it("prefers prompt_tokens over input_tokens when both present", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({
      usage: { prompt_tokens: 100, input_tokens: 200, completion_tokens: 50, output_tokens: 80 },
    });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(100);
    expect(event.output_tokens).toBe(50);
  });

  it("extracts cached_prompt_tokens from prompt_tokens_details.cached_tokens", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 30 },
      },
    });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.cached_prompt_tokens).toBe(30);
  });

  it("returns 0 for cached_prompt_tokens when prompt_tokens_details is missing", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.cached_prompt_tokens).toBe(0);
  });
});

describe("validateSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the string when it is a non-empty string", () => {
    const req = createMockReq("/chat/completions");
    const res = {
      ...createMockRes("/chat/completions"),
      locals: { providerName: "openai" },
    } as unknown as Response;
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.json as any)({ usage: {} });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.source).toBe("openai");
  });

  it('returns "unknown" for empty string', () => {
    const req = createMockReq("/chat/completions");
    const res = {
      ...createMockRes("/chat/completions"),
      locals: { providerName: "" },
    } as unknown as Response;
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.json as any)({ usage: {} });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.source).toBe("unknown");
  });

  it('returns "unknown" for non-string values (number)', () => {
    const req = createMockReq("/chat/completions");
    const res = {
      ...createMockRes("/chat/completions"),
      locals: { providerName: 42 },
    } as unknown as Response;
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.json as any)({ usage: {} });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.source).toBe("unknown");
  });

  it('returns "unknown" for null', () => {
    const req = createMockReq("/chat/completions");
    const res = {
      ...createMockRes("/chat/completions"),
      locals: { providerName: null },
    } as unknown as Response;
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.json as any)({ usage: {} });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.source).toBe("unknown");
  });

  it('returns "unknown" for undefined', () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.json as any)({ usage: {} });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.source).toBe("unknown");
  });

  it('returns "unknown" for object values', () => {
    const req = createMockReq("/chat/completions");
    const res = {
      ...createMockRes("/chat/completions"),
      locals: { providerName: { name: "test" } },
    } as unknown as Response;
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.json as any)({ usage: {} });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.source).toBe("unknown");
  });
});

describe("monitorMiddleware — path filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls next() immediately for non-monitored paths", () => {
    const req = createMockReq("/models");
    const res = createMockRes("/models");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("does NOT monkey-patch res.json for non-monitored paths", () => {
    const req = createMockReq("/models");
    const res = createMockRes("/models");
    const originalJson = res.json;
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    expect(res.json).toBe(originalJson);
  });

  it("does NOT monkey-patch res.write for non-monitored paths", () => {
    const req = createMockReq("/models");
    const res = createMockRes("/models");
    const originalWrite = res.write;
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    expect(res.write).toBe(originalWrite);
  });

  it("does NOT monkey-patch res.end for non-monitored paths", () => {
    const req = createMockReq("/models");
    const res = createMockRes("/models");
    const originalEnd = res.end;
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    expect(res.end).toBe(originalEnd);
  });

  it("proceeds with monkey-patching for /chat/completions", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    (res.end as any)();
    expect(storageWorker.append).toHaveBeenCalled();
  });

  it("proceeds with monkey-patching for /messages", () => {
    const req = createMockReq("/messages");
    const res = createMockRes("/messages");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    (res.end as any)();
    expect(storageWorker.append).toHaveBeenCalled();
  });
});

describe("monitorMiddleware — res.json monkey-patch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts usage from response body", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({
      usage: { prompt_tokens: 150, completion_tokens: 75 },
    });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(150);
    expect(event.output_tokens).toBe(75);
  });

  it("extracts error.type from body.error.type", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({
      error: { type: "invalid_request_error", message: "Bad request" },
    });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.error_type).toBe("invalid_request_error");
  });

  it("calls original res.json and returns its result", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    const body = { usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [] };
    const result = (res.json as any)(body);

    expect(result).toBe(res);
  });

  it("does not set errorType when body.error has no type field", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({ error: { message: "something" } });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.error_type).toBeNull();
  });

  it("does not set errorType when body.error is not an object", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({ error: "string error" });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.error_type).toBeNull();
  });
});

describe("monitorMiddleware — res.write monkey-patch (SSE chunks)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("increments chunk count", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("data: {}\n\n");
    (res.write as any)("data: {}\n\n");
    (res.write as any)("data: {}\n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.chunks).toBe(3);
  });

  it("handles string chunks", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.chunks).toBe(1);
    expect(event.bytes_out).toBeGreaterThan(0);
  });

  it("handles Buffer chunks", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)(Buffer.from("data: {\"choices\":[]}\n\n"));
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.chunks).toBe(1);
    expect(event.bytes_out).toBeGreaterThan(0);
  });

  it("handles Uint8Array chunks", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    const encoder = new TextEncoder();
    (res.write as any)(encoder.encode("data: {\"choices\":[]}\n\n"));
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.chunks).toBe(1);
    expect(event.bytes_out).toBeGreaterThan(0);
  });

  it("parses SSE lines starting with 'data: ' and extracts usage", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("data: {\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5}}\n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(10);
    expect(event.output_tokens).toBe(5);
  });

  it("extracts cached_prompt_tokens from SSE chunk with prompt_tokens_details", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)(
      'data: {"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":30}}}\n\n',
    );
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(100);
    expect(event.output_tokens).toBe(20);
    expect(event.cached_prompt_tokens).toBe(30);
  });

  it("skips [DONE] markers", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("data: {\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5}}\n\n");
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(10);
    expect(event.output_tokens).toBe(5);
  });

  it("extracts usage from multiple JSON data chunks (last wins)", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("data: {\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2}}\n\n");
    (res.write as any)("data: {\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":10}}\n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(20);
    expect(event.output_tokens).toBe(10);
  });

  it("extracts error type from error chunks", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("data: {\"error\":{\"type\":\"rate_limit_error\",\"message\":\"Too many\"}}\n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.error_type).toBe("rate_limit_error");
  });

  it("tracks bytesOut across multiple chunks", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("data: {\"choices\":[]}\n\n");
    (res.write as any)("data: {\"choices\":[]}\n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.bytes_out).toBeGreaterThan(0);
  });

  it("tracks firstTokenMs only on first chunk", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    vi.advanceTimersByTime(50);
    (res.write as any)("data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\n");

    vi.advanceTimersByTime(100);
    (res.write as any)("data: {\"choices\":[{\"delta\":{\"content\":\" there\"}}]}\n\n");

    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.first_token_ms).toBeGreaterThanOrEqual(50);
    expect(event.first_token_ms).toBeLessThan(150);
  });

  it("sets firstTokenMs to null when no chunks written", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.first_token_ms).toBeNull();
  });

  it("sets stream to true when res.write is called", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("data: {}\n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.stream).toBe(true);
  });

  it("sets stream to false when only res.json is used (no res.write)", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.stream).toBe(false);
  });

  it("calls original res.write and returns its result", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    const chunk = "data: {\"choices\":[]}\n\n";
    const result = (res.write as any)(chunk);

    expect(result).toBe(true);
  });

  it("skips unparseable SSE chunks gracefully", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("data: {not valid json}\n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.chunks).toBe(1);
  });

  it("ignores lines not starting with 'data: '", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("event: message\n");
    (res.write as any)(": comment line\n");
    (res.write as any)("data: {\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2}}\n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.input_tokens).toBe(5);
  });

  it("handles empty data content after 'data: '", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("data: \n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.chunks).toBe(1);
    expect(event.input_tokens).toBe(0);
  });
});

describe("monitorMiddleware — res.end monkey-patch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets errorType to http_${statusCode} when status >= 400 and no errorType set", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res as any).statusCode = 429;
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.error_type).toBe("http_429");
  });

  it("does not override existing errorType with http status", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({ error: { type: "rate_limit_error" } });
    (res as any).statusCode = 429;
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.error_type).toBe("rate_limit_error");
  });

  it("does not set errorType for status < 400", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res as any).statusCode = 200;
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.error_type).toBeNull();
  });

  it("builds MonitorEvent with all collected metrics", () => {
    const req = createMockReq("/chat/completions", { model: "gpt-4" });
    const res = {
      ...createMockRes("/chat/completions"),
      locals: {
        requestId: "req-123",
        upstreamModel: "gpt-4-0613",
        providerName: "openai",
      },
    } as unknown as Response;
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.write as any)("data: {\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":50}}\n\n");
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.request_id).toBe("req-123");
    expect(event.path).toBe("/v1/chat/completions");
    expect(event.method).toBe("POST");
    expect(event.status_code).toBe(200);
    expect(event.model_requested).toBe("gpt-4");
    expect(event.model_upstream).toBe("gpt-4-0613");
    expect(event.provider_name).toBe("openai");
    expect(event.input_tokens).toBe(100);
    expect(event.output_tokens).toBe(50);
    expect(event.stream).toBe(true);
    expect(event.chunks).toBe(1);
  });

  it("calls calculateCost with correct parameters", () => {
    const req = createMockReq("/chat/completions");
    const res = {
      ...createMockRes("/chat/completions"),
      locals: {
        upstreamModel: "mimo-v2-flash",
      },
    } as unknown as Response;
    const next = vi.fn();

    monitorMiddleware(req, res, next);

    (res.json as any)({
      usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 20 } },
    });
    (res.end as any)();

    expect(calculateCost).toHaveBeenCalledWith("mimo-v2-flash", 100, 20, 50);
  });

  it("calls storageWorker.append with the event", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.end as any)();

    expect(storageWorker.append).toHaveBeenCalledTimes(1);
    expect(storageWorker.append).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: expect.any(String),
        ts_start: expect.any(Number),
        ts_end: expect.any(Number),
        latency_ms: expect.any(Number),
        path: "/v1/chat/completions",
        method: "POST",
        status_code: 200,
      })
    );
  });

  it("calls original res.end and returns its result", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    const result = (res.end as any)();

    expect(result).toBe(res);
  });

  it("uses 'unknown' for upstreamModel when res.locals.upstreamModel is not set", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.model_upstream).toBe("unknown");
  });

  it("uses 'unknown' for providerName when res.locals.providerName is not set", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.provider_name).toBe("unknown");
  });

  it("uses 'unknown' for modelRequested when req.body.model is missing", () => {
    const req = createMockReq("/chat/completions", {});
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.model_requested).toBe("unknown");
  });

  it("uses cost from calculateCost in the event", () => {
    (calculateCost as any).mockReturnValue(0.1234);
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.cost).toBe(0.1234);
  });
});

describe("monitorMiddleware — request ID fallback chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses res.locals.requestId first", () => {
    const req = createMockReq("/chat/completions");
    const res = {
      ...createMockRes("/chat/completions"),
      locals: { requestId: "local-id-123" },
    } as unknown as Response;
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.request_id).toBe("local-id-123");
  });

  it("falls back to x-request-id header", () => {
    const req = {
      ...createMockReq("/chat/completions"),
      headers: { "x-request-id": "header-id-456" },
    } as unknown as Request;
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.request_id).toBe("header-id-456");
  });

  it("falls back to generated monitor- ID when neither is present", () => {
    const req = createMockReq("/chat/completions");
    const res = createMockRes("/chat/completions");
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.request_id).toMatch(/^monitor-/);
  });

  it("prefers res.locals.requestId over x-request-id header", () => {
    const req = {
      ...createMockReq("/chat/completions"),
      headers: { "x-request-id": "header-id" },
    } as unknown as Request;
    const res = {
      ...createMockRes("/chat/completions"),
      locals: { requestId: "local-id" },
    } as unknown as Response;
    const next = vi.fn();

    monitorMiddleware(req, res, next);
    (res.end as any)();

    const event = (storageWorker.append as any).mock.calls[0][0];
    expect(event.request_id).toBe("local-id");
  });
});
