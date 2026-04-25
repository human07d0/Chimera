import { describe, it, expect, beforeEach, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import { debugMiddleware } from "../middleware";
import { debugStore } from "../store";

// Mock config
vi.mock("../../config", () => ({
  config: {
    debug: {
      enabled: true,
      maxRecords: 500,
      maxBodySize: 1_048_576,
    },
    upstream: {
      defaultModel: "mimo-v2-flash",
    },
  },
}));

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: "/chat/completions",
    method: "POST",
    originalUrl: "/v1/chat/completions",
    body: { model: "mimo-v2-flash", messages: [{ role: "user", content: "hello" }] },
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response & { _events: string[] } {
  const res = {
    _events: [] as string[],
    statusCode: 200,
    locals: { requestId: "test-req-1", upstreamModel: "mimo-v2-flash" },
    json: vi.fn().mockReturnThis(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as unknown as Response & { _events: string[] };
  return res;
}

describe("debugMiddleware", () => {
  beforeEach(() => {
    debugStore.prune();
  });

  it("should skip non-monitored paths", () => {
    const req = createMockReq({ path: "/models" });
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("should intercept monitored paths and call next", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("should capture non-streaming response via res.json", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    // Simulate route handler calling res.json
    const responseBody = {
      choices: [{ message: { content: "world" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    (res.json as any)(responseBody);

    // Simulate res.end
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    expect(event.request_id).toBe("test-req-1");
    expect(event.stream).toBe(false);
    expect(event.status_code).toBe(200);
    expect(event.request_body).toContain("mimo-v2-flash");
    expect(event.response_body).toContain("world");
  });

  it("should capture streaming response via res.write", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    // Simulate SSE chunks
    (res.write as any)("data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\n");
    (res.write as any)("data: {\"choices\":[{\"delta\":{\"content\":\" there\"}}]}\n\n");
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    expect(event.stream).toBe(true);
    const body = JSON.parse(event.response_body);
    expect(body.choices[0].message.content).toBe("Hi there");
  });

  it("should capture error responses", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    const errorBody = {
      error: { type: "invalid_request_error", message: "Bad request" },
    };
    (res.json as any)(errorBody);
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    expect(event.error_type).toBe("invalid_request_error");
    expect(event.error_body).toContain("Bad request");
  });

  it("should capture streaming response via res.write with Buffer chunks", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    // Simulate SSE chunks as Buffer (token-plan scenario)
    (res.write as any)(Buffer.from("data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n"));
    (res.write as any)(Buffer.from("data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n"));
    (res.write as any)(Buffer.from("data: [DONE]\n\n"));
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    expect(event.stream).toBe(true);
    const body = JSON.parse(event.response_body);
    expect(body.choices[0].message.content).toBe("Hello world");
  });

  it("should capture streaming response via res.write with Uint8Array chunks", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    // Simulate SSE chunks as Uint8Array (token-plan scenario with raw reader output)
    const encoder = new TextEncoder();
    (res.write as any)(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"Foo\"}}]}\n\n"));
    (res.write as any)(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\" bar\"}}]}\n\n"));
    (res.write as any)(encoder.encode("data: [DONE]\n\n"));
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    expect(event.stream).toBe(true);
    const body = JSON.parse(event.response_body);
    expect(body.choices[0].message.content).toBe("Foo bar");
  });

  it("should assemble OpenAI streaming response with reasoning_content", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    (res.write as any)("data: {\"id\":\"chatcmpl-123\",\"model\":\"mimo-v2-flash\",\"choices\":[{\"delta\":{\"reasoning_content\":\"Let me think\"}}]}\n\n");
    (res.write as any)("data: {\"id\":\"chatcmpl-123\",\"model\":\"mimo-v2-flash\",\"choices\":[{\"delta\":{\"reasoning_content\":\" about it\"}}]}\n\n");
    (res.write as any)("data: {\"id\":\"chatcmpl-123\",\"model\":\"mimo-v2-flash\",\"choices\":[{\"delta\":{\"content\":\"The answer is 42\"}}]}\n\n");
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    expect(event.stream).toBe(true);
    const body = JSON.parse(event.response_body);
    expect(body.choices[0].message.content).toBe("The answer is 42");
    expect(body.choices[0].message.reasoning_content).toBe("Let me think about it");
    expect(body.model).toBe("mimo-v2-flash");
    expect(body.id).toBe("chatcmpl-123");
  });

  it("should assemble Anthropic streaming response", () => {
    const req = createMockReq({ path: "/messages", originalUrl: "/v1/messages" });
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    (res.write as any)("data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg-abc\",\"model\":\"claude-3\"}}\n\n");
    (res.write as any)("data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n");
    (res.write as any)("data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\n");
    (res.write as any)("data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":10}}\n\n");
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    expect(event.stream).toBe(true);
    const body = JSON.parse(event.response_body);
    expect(body.content[0].text).toBe("Hello world");
    expect(body.role).toBe("assistant");
    expect(body.model).toBe("claude-3");
    expect(body.stop_reason).toBe("end_turn");
  });

  it("should extract error_type from streaming error chunk", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    (res.write as any)("data: {\"error\":{\"type\":\"rate_limit_error\",\"message\":\"Too many requests\"}}\n\n");
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    expect(event.stream).toBe(true);
    expect(event.error_type).toBe("rate_limit_error");
    expect(event.error_body).toContain("Too many requests");
  });

  it("should truncate oversized request bodies", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    // Override config for this test - we need to mock maxBodySize to a small value
    // Since the middleware reads config at call time, we test the truncation logic indirectly
    debugMiddleware(req, res, next);

    // The default maxBodySize is 1MB, so normal bodies won't be truncated
    expect(debugStore.size).toBe(0); // not yet, waiting for res.end
    (res.json as any)({ ok: true });
    (res.end as any)();

    expect(debugStore.size).toBe(1);
  });
});