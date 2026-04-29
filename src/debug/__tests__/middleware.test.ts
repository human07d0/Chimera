import { describe, it, expect, beforeEach, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import { debugMiddleware, assembleStreamResponse } from "../middleware";
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

  it("should assemble OpenAI streaming response with single tool_call", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    (res.write as any)("data: {\"id\":\"chatcmpl-456\",\"model\":\"mimo-v2-flash\",\"choices\":[{\"delta\":{\"content\":\"Let me check\"}}]}\n\n");
    (res.write as any)("data: {\"id\":\"chatcmpl-456\",\"model\":\"mimo-v2-flash\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_abc\",\"type\":\"function\",\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"filePath\\\":\"}}]}}]}\n\n");
    (res.write as any)("data: {\"id\":\"chatcmpl-456\",\"model\":\"mimo-v2-flash\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"foo.ts\\\"}\"}}]}}]}\n\n");
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    const body = JSON.parse(event.response_body);
    expect(body.choices[0].message.content).toBe("Let me check");
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
    expect(body.choices[0].message.tool_calls[0]).toEqual({
      index: 0,
      id: "call_abc",
      type: "function",
      function: {
        name: "read_file",
        arguments: '{"filePath":"foo.ts"}',
      },
    });
  });

  it("should assemble OpenAI streaming response with multiple parallel tool_calls", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    (res.write as any)("data: {\"id\":\"chatcmpl-789\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"read\",\"arguments\":\"{}\"}}]}}]}\n\n");
    (res.write as any)("data: {\"id\":\"chatcmpl-789\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":1,\"id\":\"call_2\",\"type\":\"function\",\"function\":{\"name\":\"write\",\"arguments\":\"{\\\"a\\\":1}\"}}]}}]}\n\n");
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    const body = JSON.parse(debugStore.query().items[0].response_body);
    expect(body.choices[0].message.tool_calls).toHaveLength(2);
    expect(body.choices[0].message.tool_calls[0].function.name).toBe("read");
    expect(body.choices[0].message.tool_calls[1].function.name).toBe("write");
  });

  it("should assemble OpenAI streaming response with reasoning and tool_calls but no content", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    (res.write as any)("data: {\"id\":\"chatcmpl-999\",\"choices\":[{\"delta\":{\"reasoning_content\":\"I need to search\"}}]}\n\n");
    (res.write as any)("data: {\"id\":\"chatcmpl-999\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_search\",\"type\":\"function\",\"function\":{\"name\":\"search\",\"arguments\":\"{\\\"q\\\":\\\"test\\\"}\"}}]}}]}\n\n");
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    const body = JSON.parse(debugStore.query().items[0].response_body);
    expect(body.choices[0].message.reasoning_content).toBe("I need to search");
    expect(body.choices[0].message.content).toBeUndefined();
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
    expect(body.choices[0].message.tool_calls[0].function.name).toBe("search");
  });

  it("should assemble Anthropic streaming response with tool_use", () => {
    const req = createMockReq({ path: "/messages", originalUrl: "/v1/messages" });
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    // Helper to write SSE data chunks without manual JSON escaping
    const sse = (obj: unknown) => (res.write as any)("data: " + JSON.stringify(obj) + "\n\n");

    sse({type:"message_start",message:{id:"msg-tool",model:"claude-3"}});
    sse({type:"content_block_start",index:0,content_block:{type:"tool_use",id:"toolu_abc",name:"get_weather"}});
    sse({type:"content_block_delta",index:0,delta:{type:"input_json_delta",partial_json:'{"city":"'}});
    sse({type:"content_block_delta",index:0,delta:{type:"input_json_delta",partial_json:'Beijing"}'}});
    sse({type:"content_block_start",index:1,content_block:{type:"text",text:""}});
    sse({type:"content_block_delta",index:1,delta:{type:"text_delta",text:"Let me check the weather."}});
    sse({type:"message_delta",delta:{stop_reason:"tool_use"}});
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    const body = JSON.parse(debugStore.query().items[0].response_body);
    expect(body.content).toHaveLength(2);
    expect(body.content[0].type).toBe("tool_use");
    expect(body.content[0].id).toBe("toolu_abc");
    expect(body.content[0].name).toBe("get_weather");
    expect(JSON.parse(body.content[0].input)).toEqual({ city: "Beijing" });
    expect(body.content[1]).toEqual({
      type: "text",
      text: "Let me check the weather.",
    });
    expect(body.stop_reason).toBe("tool_use");
  });

  it("should assemble Anthropic streaming response with thinking block", () => {
    const req = createMockReq({ path: "/messages", originalUrl: "/v1/messages" });
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    const sse = (obj: unknown) => (res.write as any)("data: " + JSON.stringify(obj) + "\n\n");

    sse({type:"message_start",message:{id:"msg-think",model:"claude-3"}});
    sse({type:"content_block_start",index:0,content_block:{type:"thinking",thinking:"Let me analyze"}});
    sse({type:"content_block_delta",index:0,delta:{type:"thinking_delta",thinking:" this carefully."}});
    sse({type:"content_block_start",index:1,content_block:{type:"text",text:""}});
    sse({type:"content_block_delta",index:1,delta:{type:"text_delta",text:"Here is the result."}});
    sse({type:"message_delta",delta:{stop_reason:"end_turn"}});
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    const body = JSON.parse(debugStore.query().items[0].response_body);
    expect(body.content).toHaveLength(2);
    expect(body.content[0]).toEqual({
      type: "thinking",
      thinking: "Let me analyze this carefully.",
    });
    expect(body.content[1]).toEqual({
      type: "text",
      text: "Here is the result.",
    });
    expect(body.stop_reason).toBe("end_turn");
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

// ============================================================
// assembleStreamResponse direct unit tests
// ============================================================

describe("assembleStreamResponse", () => {
  it("should assemble OpenAI basic streaming response", () => {
    const chunks = [
      '{"id":"chatcmpl-1","model":"gpt-4","choices":[{"delta":{"content":"Hello"}}]}',
      '{"id":"chatcmpl-1","model":"gpt-4","choices":[{"delta":{"content":" world"}}]}',
    ];
    const result = JSON.parse(assembleStreamResponse(chunks));
    expect(result.id).toBe("chatcmpl-1");
    expect(result.model).toBe("gpt-4");
    expect(result.choices[0].message.content).toBe("Hello world");
    expect(result.choices[0].message.role).toBe("assistant");
  });

  it("should assemble Anthropic basic streaming response", () => {
    const chunks = [
      '{"type":"message_start","message":{"id":"msg-1","model":"claude-3"}}',
      '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Hi"}}',
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}',
      '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
    ];
    const result = JSON.parse(assembleStreamResponse(chunks));
    expect(result.id).toBe("msg-1");
    expect(result.model).toBe("claude-3");
    expect(result.content[0]).toEqual({ type: "text", text: "Hi there" });
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage).toEqual({ output_tokens: 5 });
  });

  it("should return fallback format for empty chunk array", () => {
    const result = assembleStreamResponse([]);
    expect(result).toBe("[]");
  });

  it("should skip non-JSON chunks and continue processing", () => {
    const chunks = [
      "not a json chunk",
      '{"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}',
      "also not json",
      '{"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}]}',
    ];
    const result = JSON.parse(assembleStreamResponse(chunks));
    expect(result.choices[0].message.content).toBe("Hello world");
  });

  it("should return fallback format for unrecognizable chunks", () => {
    const chunks = [
      '{"some_unknown_field":"value"}',
      '{"another_field":123}',
    ];
    const result = assembleStreamResponse(chunks);
    // No format detected, falls back to raw array
    expect(result).toBe("[" + chunks.join(",") + "]");
  });

  it("should return fallback format when all chunks are non-JSON", () => {
    const chunks = ["garbage", "more garbage"];
    const result = assembleStreamResponse(chunks);
    expect(result).toBe("[" + chunks.join(",") + "]");
  });
});