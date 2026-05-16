import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const mockLookup = vi.fn();
const mockApplyDefaults = vi.fn();
const mockPipeSSEStream = vi.fn();
const mockFetchWithTimeout = vi.fn();
const mockGenerateRequestId = vi.fn();
const mockExtractEndpointPrefix = vi.fn();
const mockSanitizeForLog = vi.fn();

vi.mock("../../providers/registry", () => ({
  modelRegistry: {
    lookup: (...args: unknown[]) => mockLookup(...args),
  },
}));

vi.mock("../../proxy/applyDefaults", () => ({
  applyDefaults: (...args: unknown[]) => mockApplyDefaults(...args),
}));

vi.mock("../../proxy/streaming", () => ({
  pipeSSEStream: (...args: unknown[]) => mockPipeSSEStream(...args),
}));

vi.mock("../../utils/fetchWithTimeout", () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../utils/requestId", () => ({
  generateRequestId: (...args: unknown[]) => mockGenerateRequestId(...args),
}));

vi.mock("../endpointPrefix", () => ({
  extractEndpointPrefix: (...args: unknown[]) => mockExtractEndpointPrefix(...args),
}));

vi.mock("../../utils/sanitizeForLog", () => ({
  sanitizeForLog: (...args: unknown[]) => mockSanitizeForLog(...args),
}));

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    headers: {},
    baseUrl: "/anthropic/v1",
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown; headersSet: Record<string, string>; locals: Record<string, unknown> } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headersSet: {} as Record<string, string>,
    locals: {} as Record<string, unknown>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.body = data;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headersSet[name] = value;
      return this;
    },
    flushHeaders() {},
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  return res as unknown as Response & { statusCode: number; body: unknown; headersSet: Record<string, string>; locals: Record<string, unknown> };
}

function findRouteHandler(
  router: unknown,
  method: string,
  path: string,
): (req: Request, res: Response) => void {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

function makeResolved(overrides: Record<string, unknown> = {}) {
  return {
    handler: {
      getAnthropicUrl: vi.fn().mockReturnValue("https://upstream.example.com/v1/messages"),
      transformRequest: vi.fn(),
      ...((overrides.handler as Record<string, unknown>) ?? {}),
    },
    modelConfig: {
      id: "virtual-model",
      upstream: "upstream-model",
      context_length: 4096,
      max_output_tokens: 2048,
      ...((overrides.modelConfig as Record<string, unknown>) ?? {}),
    },
    providerConfig: {
      name: "test-provider",
      base_url: "https://base.example.com",
      anthropic_url: "https://anthropic.example.com",
      api_key: "test-key",
      auth_header: "Authorization",
      auth_prefix: "Bearer ",
      timeout: 30000,
      ...((overrides.providerConfig as Record<string, unknown>) ?? {}),
    },
  };
}

function makeUpstreamResponse(overrides: Record<string, unknown> = {}): globalThis.Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ id: "msg-1", model: "upstream-model", content: [] }),
    text: vi.fn().mockResolvedValue(""),
    body: null,
    ...overrides,
  } as unknown as globalThis.Response;
}

describe("Anthropic Routes", () => {
  let anthropicRouter: import("express").Router;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGenerateRequestId.mockReturnValue("test-request-id");
    mockExtractEndpointPrefix.mockReturnValue("");
    mockSanitizeForLog.mockImplementation((body: unknown) => body);

    const mod = await import("../anthropic");
    anthropicRouter = mod.anthropicRouter;
  });

  describe("POST /messages - Request Validation", () => {
    it("returns 400 when request body is not an object", async () => {
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: null }), res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        type: "error",
        error: {
          type: "invalid_request",
          message: "Request body must be a JSON object",
        },
      });
    });

    it("returns 400 when request body is a string", async () => {
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: "invalid" }), res);

      expect(res.statusCode).toBe(400);
      expect((res.body as any).error.type).toBe("invalid_request");
    });

    it("returns 400 when model is missing", async () => {
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        type: "error",
        error: {
          type: "invalid_request",
          message: "Missing required parameter: model",
        },
      });
    });

    it("returns 400 when messages is missing", async () => {
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model" } }), res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        type: "error",
        error: {
          type: "invalid_request",
          message: "Missing or empty required parameter: messages",
        },
      });
    });

    it("returns 400 when messages is empty array", async () => {
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [] } }), res);

      expect(res.statusCode).toBe(400);
      expect((res.body as any).error.message).toContain("Missing or empty");
    });

    it("returns 400 when messages is not an array", async () => {
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: "not-array" } }), res);

      expect(res.statusCode).toBe(400);
      expect((res.body as any).error.message).toContain("Missing or empty");
    });
  });

  describe("POST /messages - Model Resolution", () => {
    it("returns 404 when model not found in registry", async () => {
      mockLookup.mockReturnValue(null);
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "unknown-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({
        type: "error",
        error: {
          type: "model_not_found",
          message: "The model 'unknown-model' does not exist.",
        },
      });
    });

    it("returns 404 when model doesn't support Anthropic API", async () => {
      const resolved = makeResolved();
      (resolved.handler.getAnthropicUrl as any).mockReturnValue(null);
      mockLookup.mockReturnValue(resolved);
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({
        type: "error",
        error: {
          type: "invalid_request",
          message: "The model 'test-model' does not support Anthropic messages API.",
        },
      });
    });

    it("uses anthropic_url from providerConfig when available", async () => {
      const resolved = makeResolved({ providerConfig: { anthropic_url: "https://anthropic.custom.com" } });
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(resolved.handler.getAnthropicUrl).toHaveBeenCalledWith("https://anthropic.custom.com");
    });

    it("falls back to base_url when anthropic_url is null", async () => {
      const resolved = makeResolved({ providerConfig: { anthropic_url: null, base_url: "https://base.fallback.com" } });
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(resolved.handler.getAnthropicUrl).toHaveBeenCalledWith("https://base.fallback.com");
    });

    it("calls extractEndpointPrefix with the request", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const req = mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] }, baseUrl: "/token-plan/anthropic/v1" });
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(req, res);

      expect(mockExtractEndpointPrefix).toHaveBeenCalledWith(req);
      expect(mockLookup).toHaveBeenCalledWith("test-model", "");
    });
  });

  describe("POST /messages - Anthropic Header Forwarding", () => {
    it("forwards anthropic-version header to upstream", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(
        mockReq({
          body: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
          headers: { "anthropic-version": "2023-06-01" },
        }),
        res,
      );

      const fetchCall = mockFetchWithTimeout.mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers["anthropic-version"]).toBe("2023-06-01");
    });

    it("forwards anthropic-beta header to upstream", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(
        mockReq({
          body: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
          headers: { "anthropic-beta": "messages-2023-12-15" },
        }),
        res,
      );

      const fetchCall = mockFetchWithTimeout.mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers["anthropic-beta"]).toBe("messages-2023-12-15");
    });

    it("joins array headers with comma", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(
        mockReq({
          body: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
          headers: { "anthropic-version": ["2023-06-01", "2024-01-01"] },
        }),
        res,
      );

      const fetchCall = mockFetchWithTimeout.mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers["anthropic-version"]).toBe("2023-06-01, 2024-01-01");
    });

    it("does not set anthropic headers when not present in request", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(
        mockReq({
          body: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
          headers: {},
        }),
        res,
      );

      const fetchCall = mockFetchWithTimeout.mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers["anthropic-version"]).toBeUndefined();
      expect(headers["anthropic-beta"]).toBeUndefined();
    });
  });

  describe("POST /messages - Successful Requests", () => {
    it("non-streaming: calls res.json with response body and rewrites model", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      const upstreamBody = { id: "msg-1", model: "upstream-model", content: [{ type: "text", text: "hello" }] };
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
        json: vi.fn().mockResolvedValue(upstreamBody),
      }));
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.body).toEqual({ id: "msg-1", model: "virtual-model", content: [{ type: "text", text: "hello" }] });
    });

    it("non-streaming: sets res.locals properties", async () => {
      const resolved = makeResolved({
        modelConfig: { id: "local-model-id", upstream: "local-upstream" },
        providerConfig: { name: "local-provider" },
      });
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.locals.requestId).toBe("test-request-id");
      expect(res.locals.virtualModelId).toBe("local-model-id");
      expect(res.locals.providerName).toBe("local-provider");
      expect(res.locals.upstreamModel).toBe("local-upstream");
    });

    it("streaming: calls pipeSSEStream with correct arguments", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockPipeSSEStream.mockResolvedValue({ inputTokens: 0, outputTokens: 0, cacheHit: false });
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({ ok: true }));
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }], stream: true } }), res);

      expect(mockPipeSSEStream).toHaveBeenCalledTimes(1);
      const [upstreamRes, clientRes, virtualModelId, options] = mockPipeSSEStream.mock.calls[0];
      expect(clientRes).toBe(res);
      expect(virtualModelId).toBe("virtual-model");
      expect(options.skipEmptyLines).toBe(false);
      expect(options.sendErrorChunk).toBe(false);
      expect(typeof options.onChunk).toBe("function");
      expect(options.usageRef).toBeDefined();
    });

    it("streaming: sets X-Request-Id header", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockPipeSSEStream.mockResolvedValue({ inputTokens: 0, outputTokens: 0, cacheHit: false });
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }], stream: true } }), res);

      expect(res.headersSet["X-Request-Id"]).toBe("test-request-id");
    });

    it("streaming: sets res.locals properties", async () => {
      const resolved = makeResolved({
        modelConfig: { id: "stream-model", upstream: "stream-upstream" },
        providerConfig: { name: "stream-provider" },
      });
      mockLookup.mockReturnValue(resolved);
      mockPipeSSEStream.mockResolvedValue({ inputTokens: 0, outputTokens: 0, cacheHit: false });
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }], stream: true } }), res);

      expect(res.locals.requestId).toBe("test-request-id");
      expect(res.locals.virtualModelId).toBe("stream-model");
      expect(res.locals.providerName).toBe("stream-provider");
      expect(res.locals.upstreamModel).toBe("stream-upstream");
    });

    it("calls applyDefaults with body, defaults, and original body", async () => {
      const resolved = makeResolved({ modelConfig: { default: { temperature: 0.7 } } });
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");
      const clientBody = { model: "test-model", messages: [{ role: "user", content: "hi" }] };

      await handler(mockReq({ body: clientBody }), res);

      expect(mockApplyDefaults).toHaveBeenCalledTimes(1);
      const [body, defaults, originalBody] = mockApplyDefaults.mock.calls[0];
      expect(defaults).toEqual({ temperature: 0.7 });
      expect(originalBody).toEqual(clientBody);
      expect(body.model).toBe("upstream-model");
    });

    it("calls handler.transformRequest with correct arguments", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");
      const clientBody = { model: "test-model", messages: [{ role: "user", content: "hi" }] };

      await handler(mockReq({ body: clientBody }), res);

      expect(resolved.handler.transformRequest).toHaveBeenCalledTimes(1);
      const [body, modelConfig, originalBody, providerConfig] = resolved.handler.transformRequest.mock.calls[0];
      expect(modelConfig).toBe(resolved.modelConfig);
      expect(originalBody).toEqual(clientBody);
      expect(providerConfig).toBe(resolved.providerConfig);
    });

    it("sends correct auth headers to upstream", async () => {
      const resolved = makeResolved({
        providerConfig: {
          auth_header: "X-Api-Key",
          auth_prefix: "sk-",
          api_key: "my-secret",
        },
      });
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      const fetchCall = mockFetchWithTimeout.mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers["X-Api-Key"]).toBe("sk-my-secret");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["X-Request-Id"]).toBe("test-request-id");
    });
  });

  describe("POST /messages - Streaming onChunk Callback", () => {
    async function getOnChunk(): Promise<(line: string) => string | null> {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockPipeSSEStream.mockResolvedValue({ inputTokens: 0, outputTokens: 0, cacheHit: false });
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse());

      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");
      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }], stream: true } }), res);

      return mockPipeSSEStream.mock.calls[0][3].onChunk;
    }

    it("rewrites model in message_start event", async () => {
      const onChunk = await getOnChunk();
      const line = `data: ${JSON.stringify({ type: "message_start", message: { model: "upstream-model", id: "msg-1" } })}`;

      const result = onChunk(line);

      const parsed = JSON.parse(result!.slice("data: ".length));
      expect(parsed.message.model).toBe("virtual-model");
    });

    it("does not modify message_start if message field is missing", async () => {
      const onChunk = await getOnChunk();
      const line = `data: ${JSON.stringify({ type: "message_start", id: "msg-1" })}`;

      const result = onChunk(line);

      const parsed = JSON.parse(result!.slice("data: ".length));
      expect(parsed.message).toBeUndefined();
    });

    it("extracts usage from message_delta event", async () => {
      const onChunk = await getOnChunk();
      const line = `data: ${JSON.stringify({ type: "message_delta", usage: { input_tokens: 10, output_tokens: 20 } })}`;

      onChunk(line);

      const usageRef = mockPipeSSEStream.mock.calls[0][3].usageRef;
      expect(usageRef.inputTokens).toBe(10);
      expect(usageRef.outputTokens).toBe(20);
    });

    it("detects cache hit when cache_read_input_tokens > 0", async () => {
      const onChunk = await getOnChunk();
      const line = `data: ${JSON.stringify({ type: "message_delta", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } })}`;

      onChunk(line);

      const usageRef = mockPipeSSEStream.mock.calls[0][3].usageRef;
      expect(usageRef.cacheHit).toBe(true);
    });

    it("does not detect cache hit when cache_read_input_tokens is 0", async () => {
      const onChunk = await getOnChunk();
      const line = `data: ${JSON.stringify({ type: "message_delta", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 } })}`;

      onChunk(line);

      const usageRef = mockPipeSSEStream.mock.calls[0][3].usageRef;
      expect(usageRef.cacheHit).toBeUndefined();
    });

    it("returns modified line as data: JSON", async () => {
      const onChunk = await getOnChunk();
      const original = { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } };
      const line = `data: ${JSON.stringify(original)}`;

      const result = onChunk(line);

      expect(result).toBe(`data: ${JSON.stringify(original)}`);
    });

    it("passes through non-data lines unchanged", async () => {
      const onChunk = await getOnChunk();
      const line = "event: message_start";

      const result = onChunk(line);

      expect(result).toBe("event: message_start");
    });

    it("handles malformed JSON gracefully", async () => {
      const onChunk = await getOnChunk();
      const line = "data: {invalid json}";

      const result = onChunk(line);

      expect(result).toBe("data: {invalid json}");
    });

    it("does not overwrite usage fields when not present in message_delta", async () => {
      const onChunk = await getOnChunk();
      const usageRef = mockPipeSSEStream.mock.calls[0][3].usageRef;
      usageRef.inputTokens = 42;

      const line = `data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 5 } })}`;
      onChunk(line);

      expect(usageRef.inputTokens).toBe(42);
      expect(usageRef.outputTokens).toBe(5);
    });
  });

  describe("GET /messages", () => {
    it("returns 405 with correct Anthropic error format", () => {
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "get", "/messages");

      handler(mockReq(), res);

      expect(res.statusCode).toBe(405);
      expect(res.body).toEqual({
        type: "error",
        error: {
          type: "invalid_request",
          message: "Anthropic Messages API only supports POST method. Use POST /anthropic/v1/messages.",
        },
      });
    });
  });

  describe("POST /messages - Error Handling", () => {
    it("returns 502 with rate_limit_error on timeout", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockRejectedValue(new Error("Request timed out after 30000ms"));
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({
        type: "error",
        error: {
          type: "rate_limit_error",
          message: "Request to upstream API timed out",
        },
      });
    });

    it("returns 502 with rate_limit_error when error message contains 'timeout'", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockRejectedValue(new Error("connection timeout"));
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.statusCode).toBe(502);
      expect((res.body as any).error.type).toBe("rate_limit_error");
    });

    it("returns 502 with upstream_error on fetch failure", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockRejectedValue(new Error("ECONNREFUSED"));
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({
        type: "error",
        error: {
          type: "upstream_error",
          message: "Failed to reach upstream API: ECONNREFUSED",
        },
      });
    });

    it("handles non-Error fetch exceptions", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockRejectedValue("string error");
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.statusCode).toBe(502);
      expect((res.body as any).error.message).toContain("string error");
    });

    it("converts upstream non-2xx response with JSON error body", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      const errorBody = { error: { type: "invalid_request_error", message: "Bad field" } };
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue(errorBody),
      }));
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Bad field",
        },
      });
    });

    it("converts upstream non-2xx response with non-JSON error body", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error("not json")),
        text: vi.fn().mockResolvedValue("Internal Server Error"),
      }));
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.statusCode).toBe(500);
      expect((res.body as any).type).toBe("error");
      expect((res.body as any).error.message).toBe("Internal Server Error");
    });

    it("falls back to 'Unknown error' when text() also fails", async () => {
      const resolved = makeResolved();
      mockLookup.mockReturnValue(resolved);
      mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
        ok: false,
        status: 502,
        json: vi.fn().mockRejectedValue(new Error("not json")),
        text: vi.fn().mockRejectedValue(new Error("text failed")),
      }));
      const res = mockRes();
      const handler = findRouteHandler(anthropicRouter, "post", "/messages");

      await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

      expect(res.statusCode).toBe(502);
      expect((res.body as any).error.message).toBe("Unknown error");
    });
  });

  describe("Helper Functions (via route behavior)", () => {
    describe("sendAnthropicError", () => {
      it("produces correct JSON structure with type and error fields", async () => {
        mockLookup.mockReturnValue(null);
        const res = mockRes();
        const handler = findRouteHandler(anthropicRouter, "post", "/messages");

        await handler(mockReq({ body: { model: "m", messages: [{ role: "user", content: "hi" }] } }), res);

        expect(res.body).toHaveProperty("type", "error");
        expect(res.body).toHaveProperty("error");
        expect((res.body as any).error).toHaveProperty("type");
        expect((res.body as any).error).toHaveProperty("message");
      });
    });

    describe("convertUpstreamError", () => {
      it("handles null error body", async () => {
        const resolved = makeResolved();
        mockLookup.mockReturnValue(resolved);
        mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
          ok: false,
          status: 500,
          json: vi.fn().mockResolvedValue(null),
        }));
        const res = mockRes();
        const handler = findRouteHandler(anthropicRouter, "post", "/messages");

        await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

        expect(res.body).toEqual({
          type: "error",
          error: {
            type: "upstream_error",
            message: "Upstream error (500)",
          },
        });
      });

      it("handles object error body without nested error field", async () => {
        const resolved = makeResolved();
        mockLookup.mockReturnValue(resolved);
        mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
          ok: false,
          status: 429,
          json: vi.fn().mockResolvedValue({ message: "Rate limited" }),
        }));
        const res = mockRes();
        const handler = findRouteHandler(anthropicRouter, "post", "/messages");

        await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

        expect((res.body as any).error.type).toBe("rate_limit_error");
        expect((res.body as any).error.message).toBe("Rate limited");
      });

      it("extracts nested error type and message", async () => {
        const resolved = makeResolved();
        mockLookup.mockReturnValue(resolved);
        mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
          ok: false,
          status: 400,
          json: vi.fn().mockResolvedValue({
            error: { type: "invalid_request_error", message: "Missing param" },
          }),
        }));
        const res = mockRes();
        const handler = findRouteHandler(anthropicRouter, "post", "/messages");

        await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

        expect((res.body as any).error.type).toBe("invalid_request_error");
        expect((res.body as any).error.message).toBe("Missing param");
      });

      it("falls back to status-based type when nested error has no type", async () => {
        const resolved = makeResolved();
        mockLookup.mockReturnValue(resolved);
        mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
          ok: false,
          status: 401,
          json: vi.fn().mockResolvedValue({ error: { message: "Unauthorized" } }),
        }));
        const res = mockRes();
        const handler = findRouteHandler(anthropicRouter, "post", "/messages");

        await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

        expect((res.body as any).error.type).toBe("authentication_error");
      });
    });

    describe("getErrorTypeFromStatus", () => {
      it("returns authentication_error for 401", async () => {
        const resolved = makeResolved();
        mockLookup.mockReturnValue(resolved);
        mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
          ok: false,
          status: 401,
          json: vi.fn().mockResolvedValue({}),
        }));
        const res = mockRes();
        const handler = findRouteHandler(anthropicRouter, "post", "/messages");

        await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

        expect((res.body as any).error.type).toBe("authentication_error");
      });

      it("returns permission_error for 403", async () => {
        const resolved = makeResolved();
        mockLookup.mockReturnValue(resolved);
        mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
          ok: false,
          status: 403,
          json: vi.fn().mockResolvedValue({}),
        }));
        const res = mockRes();
        const handler = findRouteHandler(anthropicRouter, "post", "/messages");

        await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

        expect((res.body as any).error.type).toBe("permission_error");
      });

      it("returns rate_limit_error for 429", async () => {
        const resolved = makeResolved();
        mockLookup.mockReturnValue(resolved);
        mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
          ok: false,
          status: 429,
          json: vi.fn().mockResolvedValue({}),
        }));
        const res = mockRes();
        const handler = findRouteHandler(anthropicRouter, "post", "/messages");

        await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

        expect((res.body as any).error.type).toBe("rate_limit_error");
      });

      it("returns upstream_error for 5xx", async () => {
        const resolved = makeResolved();
        mockLookup.mockReturnValue(resolved);
        mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
          ok: false,
          status: 503,
          json: vi.fn().mockResolvedValue({}),
        }));
        const res = mockRes();
        const handler = findRouteHandler(anthropicRouter, "post", "/messages");

        await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

        expect((res.body as any).error.type).toBe("upstream_error");
      });

      it("returns invalid_request for other status codes", async () => {
        const resolved = makeResolved();
        mockLookup.mockReturnValue(resolved);
        mockFetchWithTimeout.mockResolvedValue(makeUpstreamResponse({
          ok: false,
          status: 422,
          json: vi.fn().mockResolvedValue({}),
        }));
        const res = mockRes();
        const handler = findRouteHandler(anthropicRouter, "post", "/messages");

        await handler(mockReq({ body: { model: "test-model", messages: [{ role: "user", content: "hi" }] } }), res);

        expect((res.body as any).error.type).toBe("invalid_request");
      });
    });
  });
});
