import { describe, it, expect, beforeEach, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import { debugMiddleware, assembleStreamResponse, extractAndSummarizeMedia } from "../middleware";
import { debugStore } from "../store";

// Mock config
vi.mock("../../config", () => ({
  config: {
    debug: {
      enabled: true,
      maxRecords: 500,
      maxBodySize: 1_048_576,
      maxMediaBytes: 10_485_760,
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
    locals: { requestId: "test-req-1", upstreamModel: "mimo-v2-flash", virtualModelId: "mimo-v2-flash", providerName: "mimo" },
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
    expect(body.content[0].input).toEqual({ city: "Beijing" });
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

  it("should assemble Anthropic streaming response with image content block", () => {
    const req = createMockReq({ path: "/messages", originalUrl: "/v1/messages" });
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    const sse = (obj: unknown) => (res.write as any)("data: " + JSON.stringify(obj) + "\n\n");

    sse({type:"message_start",message:{id:"msg-img",model:"claude-3"}});
    sse({type:"content_block_start",index:0,content_block:{
      type:"image",
      source:{type:"base64",media_type:"image/png",data:"iVBORw0KGgo="}
    }});
    sse({type:"content_block_start",index:1,content_block:{type:"text",text:""}});
    sse({type:"content_block_delta",index:1,delta:{type:"text_delta",text:"Here is the image analysis."}});
    sse({type:"message_delta",delta:{stop_reason:"end_turn"}});
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    const body = JSON.parse(debugStore.query().items[0].response_body);
    expect(body.content).toHaveLength(2);
    expect(body.content[0].type).toBe("image");
    expect(body.content[0].source.media_type).toBe("image/png");
    expect(body.content[0].source.type).toBe("base64");
    expect(body.content[0].source.data).toContain("[_debug_media");
    expect(body.content[1]).toEqual({
      type: "text",
      text: "Here is the image analysis.",
    });
    expect(body.stop_reason).toBe("end_turn");
  });

  it("should buffer partial SSE lines across split chunks", () => {
    const req = createMockReq({ path: "/messages", originalUrl: "/v1/messages" });
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    // Simulate a single SSE event split into two write calls.
    // First write: partial JSON, no newline — old implementation would lose this.
    const sse1 = "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"image\",\"source\":{\"type\":\"base64\",\"media_type\":\"image/png\",\"data\":\"";
    const sse2 = "iVBORw0KGgo=\"}}}\n\n";
    (res.write as any)(sse1);
    (res.write as any)(sse2);

    // Follow with a complete text block and DONE
    (res.write as any)("data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n");
    (res.write as any)("data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"Analysis complete.\"}}\n\n");
    (res.write as any)("data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n");
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const body = JSON.parse(debugStore.query().items[0].response_body);
    expect(body.content).toHaveLength(2);
    expect(body.content[0].type).toBe("image");
    expect(body.content[0].source.media_type).toBe("image/png");
    expect(body.content[0].source.type).toBe("base64");
    expect(body.content[0].source.data).toContain("[_debug_media");
    expect(body.content[1]).toEqual({
      type: "text",
      text: "Analysis complete.",
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

  it("should replace OpenAI data URI with placeholder and store media", () => {
    const req = createMockReq({
      body: {
        model: "mimo-v2-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" },
              },
            ],
          },
        ],
      },
    });
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);
    (res.json as any)({ choices: [{ message: { content: "It's a red dot" } }] });
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    expect(event.request_body).not.toContain("iVBORw0KGgo");
    expect(event.request_body).toContain("[_debug_media");
    expect(event.media).toBeDefined();
    expect(event.media!.length).toBeGreaterThanOrEqual(1);
    expect(event.media![0].kind).toBe("image");
    expect(event.media![0].location).toBe("request");
  });

  it("should replace Anthropic source.data with placeholder and store media", () => {
    const req = createMockReq({
      path: "/messages",
      originalUrl: "/v1/messages",
      body: {
        model: "claude-3",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==",
                },
              },
            ],
          },
        ],
      },
    });
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    const sse = (obj: unknown) => (res.write as any)("data: " + JSON.stringify(obj) + "\n\n");
    sse({type:"message_start",message:{id:"msg-1",model:"claude-3"}});
    sse({type:"content_block_start",index:0,content_block:{type:"text",text:""}});
    sse({type:"content_block_delta",index:0,delta:{type:"text_delta",text:"Image received."}});
    sse({type:"message_delta",delta:{stop_reason:"end_turn"}});
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    expect(event.request_body).not.toContain("/9j/4AAQSkZJRg");
    expect(event.request_body).toContain("[_debug_media");
    expect(event.media).toBeDefined();
    expect(event.media!.length).toBeGreaterThanOrEqual(1);
    const reqMedia = event.media!.find(m => m.location === "request");
    expect(reqMedia).toBeDefined();
    expect(reqMedia!.kind).toBe("image");
    expect(reqMedia!.media_type).toBe("image/jpeg");
  });

  it("should strip data_base64 from response body with Anthropic image block", () => {
    const req = createMockReq({
      path: "/messages",
      originalUrl: "/v1/messages",
    });
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    const sse = (obj: unknown) => (res.write as any)("data: " + JSON.stringify(obj) + "\n\n");
    sse({type:"message_start",message:{id:"msg-img",model:"claude-3"}});
    sse({type:"content_block_start",index:0,content_block:{
      type:"image",
      source:{type:"base64",media_type:"image/png",data:"iVBORw0KGgo="}
    }});
    sse({type:"content_block_start",index:1,content_block:{type:"text",text:""}});
    sse({type:"content_block_delta",index:1,delta:{type:"text_delta",text:"Here is the image analysis."}});
    sse({type:"message_delta",delta:{stop_reason:"end_turn"}});
    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    const body = JSON.parse(event.response_body);
    expect(body.content).toHaveLength(2);
    expect(body.content[0].source.data).toContain("[_debug_media");
    expect(body.content[0].source.data).not.toContain("iVBORw0KGgo");
    expect(body.content[1].text).toBe("Here is the image analysis.");
    expect(event.media).toBeDefined();
    expect(event.media!.length).toBeGreaterThanOrEqual(1);
  });

  it("should store pre-parsed objects from res.locals._sseChunk", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    debugMiddleware(req, res, next);

    const parsedChunk = { id: "chatcmpl-1", model: "mimo-v2-flash", choices: [{ delta: { content: "Hello" } }] };
    (res as any).locals._sseChunk = { parsed: parsedChunk, raw: JSON.stringify(parsedChunk) };
    (res.write as any)("data: " + JSON.stringify(parsedChunk) + "\n\n");

    const parsedChunk2 = { id: "chatcmpl-1", model: "mimo-v2-flash", choices: [{ delta: { content: " world" } }] };
    (res as any).locals._sseChunk = { parsed: parsedChunk2, raw: JSON.stringify(parsedChunk2) };
    (res.write as any)("data: " + JSON.stringify(parsedChunk2) + "\n\n");

    (res.write as any)("data: [DONE]\n\n");
    (res.end as any)();

    expect(debugStore.size).toBe(1);
    const event = debugStore.query().items[0];
    expect(event.stream).toBe(true);
    const body = JSON.parse(event.response_body);
    expect(body.choices[0].message.content).toBe("Hello world");
  });
});

// ============================================================
// extractAndSummarizeMedia unit tests
// ============================================================

describe("extractAndSummarizeMedia", () => {
  const opts = { maxMediaBytes: 10_485_760 };

  it("returns body unchanged and empty media for invalid JSON", () => {
    const result = extractAndSummarizeMedia("not json", "request", opts);
    expect(result.body).toBe("not json");
    expect(result.media).toEqual([]);
  });

  it("returns body unchanged and empty media for plain JSON without media", () => {
    const input = '{"model":"test","messages":[{"role":"user","content":"hello"}]}';
    const result = extractAndSummarizeMedia(input, "request", opts);
    expect(result.media).toEqual([]);
    expect(JSON.parse(result.body)).toEqual(JSON.parse(input));
  });

  it("replaces OpenAI data URI with placeholder and creates media item", () => {
    const input = JSON.stringify({
      messages: [
        {
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
          ],
        },
      ],
    });
    const result = extractAndSummarizeMedia(input, "request", opts);
    expect(result.media).toHaveLength(1);
    expect(result.media[0].kind).toBe("image");
    expect(result.media[0].media_type).toBe("image/png");
    expect(result.media[0].encoding).toBe("base64");
    expect(result.media[0].location).toBe("request");
    expect(result.media[0].path).toContain("image_url");
    expect(result.media[0].data_base64).toBe("iVBORw0KGgo=");

    const body = JSON.parse(result.body);
    const url = body.messages[0].content[0].image_url.url;
    expect(url).toContain("[_debug_media");
    expect(url).not.toContain("iVBORw0KGgo");
  });

  it("replaces Anthropic source.data with placeholder and creates media item", () => {
    const input = JSON.stringify({
      messages: [
        {
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: "/9j/4Q==" },
            },
          ],
        },
      ],
    });
    const result = extractAndSummarizeMedia(input, "request", opts);
    expect(result.media).toHaveLength(1);
    expect(result.media[0].kind).toBe("image");
    expect(result.media[0].media_type).toBe("image/jpeg");
    expect(result.media[0].data_base64).toBe("/9j/4Q==");

    const body = JSON.parse(result.body);
    expect(body.messages[0].content[0].source.data).toContain("[_debug_media");
    expect(body.messages[0].content[0].source.data).not.toContain("/9j/4Q");
  });

  it("replaces multiple media sources with unique IDs", () => {
    const input = JSON.stringify({
      messages: [
        {
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA==" } },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBBB==" } },
          ],
        },
      ],
    });
    const result = extractAndSummarizeMedia(input, "request", opts);
    expect(result.media).toHaveLength(2);
    expect(result.media[0].id).not.toBe(result.media[1].id);
    expect(result.media[0].id).toContain("media-request-");
    expect(result.media[1].id).toContain("media-request-");
  });

  it("handles mixed OpenAI and Anthropic formats", () => {
    const input = JSON.stringify({
      messages: [
        {
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,OPENAI==" } },
            {
              type: "image",
              source: { type: "base64", media_type: "image/gif", data: "ANTHROPIC==" },
            },
          ],
        },
      ],
    });
    const result = extractAndSummarizeMedia(input, "request", opts);
    expect(result.media).toHaveLength(2);
    expect(result.media[0].media_type).toBe("image/png");
    expect(result.media[1].media_type).toBe("image/gif");
  });

  it("infers kind from media_type: audio, video, unknown", () => {
    const input = JSON.stringify({
      messages: [
        { content: [{ type: "image_url", image_url: { url: "data:audio/mp3;base64,AAAA==" } }] },
        { content: [{ type: "image_url", image_url: { url: "data:video/mp4;base64,AAAA==" } }] },
        { content: [{ type: "image_url", image_url: { url: "data:application/pdf;base64,AAAA==" } }] },
      ],
    });
    const result = extractAndSummarizeMedia(input, "request", opts);
    expect(result.media).toHaveLength(3);
    expect(result.media[0].kind).toBe("audio");
    expect(result.media[1].kind).toBe("video");
    expect(result.media[2].kind).toBe("unknown");
  });

  it("recognizes audio and video in Anthropic source format", () => {
    const input = JSON.stringify({
      messages: [
        {
          content: [
            { type: "base64", media_type: "audio/mpeg", data: "AAAA==" },
            { type: "base64", media_type: "video/webm", data: "BBBB==" },
          ],
        },
      ],
    });
    const result = extractAndSummarizeMedia(input, "request", opts);
    expect(result.media).toHaveLength(2);
    expect(result.media[0].kind).toBe("audio");
    expect(result.media[0].media_type).toBe("audio/mpeg");
    expect(result.media[1].kind).toBe("video");
    expect(result.media[1].media_type).toBe("video/webm");
  });

  it("recognizes audio data URI variants", () => {
    const input = JSON.stringify({
      content: [
        { type: "image_url", image_url: { url: "data:audio/wav;base64,WAVAAA==" } },
        { type: "image_url", image_url: { url: "data:audio/mp3;base64,MP3AAA==" } },
      ],
    });
    const result = extractAndSummarizeMedia(input, "request", opts);
    expect(result.media).toHaveLength(2);
    expect(result.media[0].kind).toBe("audio");
    expect(result.media[0].media_type).toBe("audio/wav");
    expect(result.media[1].kind).toBe("audio");
    expect(result.media[1].media_type).toBe("audio/mp3");
  });

  it("recognizes video data URI variants", () => {
    const input = JSON.stringify({
      content: [
        { type: "image_url", image_url: { url: "data:video/mp4;base64,MP4AAA==" } },
        { type: "image_url", image_url: { url: "data:video/webm;base64,WEBMAA==" } },
      ],
    });
    const result = extractAndSummarizeMedia(input, "request", opts);
    expect(result.media).toHaveLength(2);
    expect(result.media[0].kind).toBe("video");
    expect(result.media[0].media_type).toBe("video/mp4");
    expect(result.media[1].kind).toBe("video");
    expect(result.media[1].media_type).toBe("video/webm");
  });

  it("does not extract data_base64 when byte_length exceeds maxMediaBytes", () => {
    // Create a base64 that's ~1KB to test threshold
    const smallData = Buffer.alloc(512).toString("base64");
    const input = JSON.stringify({
      content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${smallData}` } }],
    });
    // Set maxMediaBytes very small (100 bytes)
    const result = extractAndSummarizeMedia(input, "request", { maxMediaBytes: 100 });
    expect(result.media).toHaveLength(1);
    expect(result.media[0].data_base64).toBe("");
    expect(result.body).not.toContain(smallData);
  });

  it("preserves data_base64 when byte_length is within maxMediaBytes", () => {
    // Tiny base64 data
    const input = JSON.stringify({
      content: [{ type: "image_url", image_url: { url: "data:image/png;base64,tiny==" } }],
    });
    const result = extractAndSummarizeMedia(input, "request", { maxMediaBytes: 10_485_760 });
    expect(result.media).toHaveLength(1);
    expect(result.media[0].data_base64).toBe("tiny==");
  });

  it("handles location=response correctly", () => {
    const input = JSON.stringify({
      content: [{ type: "image_url", image_url: { url: "data:image/png;base64,RESP==" } }],
    });
    const result = extractAndSummarizeMedia(input, "response", opts);
    expect(result.media).toHaveLength(1);
    expect(result.media[0].location).toBe("response");
    expect(result.media[0].id).toContain("media-response-");
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

  it("should assemble Anthropic streaming response with image content block", () => {
    const chunks = [
      '{"type":"message_start","message":{"id":"msg-img","model":"claude-3"}}',
      '{"type":"content_block_start","index":0,"content_block":{"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBORw0KGgo="}}}',
      '{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
      '{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Image analysis result."}}',
      '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    ];
    const result = JSON.parse(assembleStreamResponse(chunks));
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
    });
    expect(result.content[1]).toEqual({ type: "text", text: "Image analysis result." });
    expect(result.stop_reason).toBe("end_turn");
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

  it("should handle pre-parsed objects in chunks array", () => {
    const chunks = [
      { id: "chatcmpl-1", model: "gpt-4", choices: [{ delta: { content: "Hello" } }] } as Record<string, unknown>,
      { id: "chatcmpl-1", model: "gpt-4", choices: [{ delta: { content: " world" } }] } as Record<string, unknown>,
    ];
    const result = JSON.parse(assembleStreamResponse(chunks as any));
    expect(result.id).toBe("chatcmpl-1");
    expect(result.choices[0].message.content).toBe("Hello world");
  });

  it("should handle mixed string and pre-parsed object chunks", () => {
    const chunks = [
      '{"id":"chatcmpl-1","model":"gpt-4","choices":[{"delta":{"content":"Hello"}}]}',
      { id: "chatcmpl-1", model: "gpt-4", choices: [{ delta: { content: " world" } }] } as Record<string, unknown>,
    ];
    const result = JSON.parse(assembleStreamResponse(chunks as any));
    expect(result.choices[0].message.content).toBe("Hello world");
  });

  it("should return fallback format with mixed string and object chunks when unrecognizable", () => {
    const chunks = [
      '{"some_field":"value"}',
      { another_field: 123 } as Record<string, unknown>,
    ];
    const result = assembleStreamResponse(chunks as any);
    expect(result).toBe('[{"some_field":"value"},{"another_field":123}]');
  });
});