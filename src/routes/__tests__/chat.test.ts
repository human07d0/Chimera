import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import * as http from "http";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../utils/requestId", () => ({
  generateRequestId: vi.fn(() => "test-req-123"),
}));

vi.mock("../../providers/registry", () => ({
  modelRegistry: {
    lookup: vi.fn(),
  },
}));

vi.mock("../../proxy/applyDefaults", () => ({
  applyDefaults: vi.fn(),
}));

vi.mock("../../proxy/streaming", () => ({
  pipeSSEStream: vi.fn(),
}));

vi.mock("../../utils/fetchWithTimeout", () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock("../../utils/sanitizeForLog", () => ({
  sanitizeForLog: vi.fn((v: unknown) => v),
}));

vi.mock("../endpointPrefix", () => ({
  extractEndpointPrefix: vi.fn(() => ""),
}));

import { chatRouter } from "../chat";
import { modelRegistry } from "../../providers/registry";
import { applyDefaults } from "../../proxy/applyDefaults";
import { pipeSSEStream } from "../../proxy/streaming";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout";
import { generateRequestId } from "../../utils/requestId";
import { extractEndpointPrefix } from "../endpointPrefix";

function defaultProviderConfig() {
  return {
    name: "test-provider",
    base_url: "https://api.test.com",
    api_key: "test-api-key",
    auth_header: "Authorization",
    auth_prefix: "Bearer ",
    timeout: 120000,
  };
}

function defaultModelConfig() {
  return {
    id: "test-model-virtual",
    upstream: "test-model-upstream",
    default: {},
  };
}

function defaultHandler() {
  return {
    getOpenAIUrl: vi.fn(() => "https://api.test.com/v1/chat/completions"),
    transformRequest: vi.fn(),
  };
}

function makeUpstreamResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  const bodyStr = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(bodyStr),
  } as unknown as Response;
}

function makeStreamUpstreamResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"model":"m","choices":[]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return {
    body: stream,
    status: 200,
    ok: true,
    headers: new Headers(),
  } as unknown as Response;
}

let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(extractEndpointPrefix).mockReturnValue("");
  vi.mocked(modelRegistry.lookup).mockReturnValue({
    handler: defaultHandler(),
    modelConfig: defaultModelConfig(),
    providerConfig: defaultProviderConfig(),
  } as any);

  const app = express();
  app.use(express.json({ strict: false }));
  app.use("/v1", chatRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

async function postChat(body: unknown): Promise<{
  status: number;
  body: any;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(`${baseUrl}/v1/chat/completions`);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let bodyData = "";
        res.on("data", (chunk: Buffer) => {
          bodyData += chunk.toString();
        });
        res.on("end", () => {
          let parsed: any;
          try {
            parsed = JSON.parse(bodyData);
          } catch {
            parsed = bodyData;
          }
          resolve({
            status: res.statusCode!,
            body: parsed,
            headers: res.headers,
          });
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function postChatStreaming(body: unknown): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  rawBody: string;
}> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(`${baseUrl}/v1/chat/completions`);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let bodyData = "";
        res.on("data", (chunk: Buffer) => {
          bodyData += chunk.toString();
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            rawBody: bodyData,
          });
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

describe("POST /v1/chat/completions", () => {
  describe("request validation", () => {
    it("returns 400 when request body is not an object", async () => {
      const res = await postChat("not-an-object" as any);
      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe("invalid_request_error");
      expect(res.body.error.message).toBe(
        "Request body must be a JSON object",
      );
    });

    it("returns 400 when model is missing", async () => {
      const res = await postChat({
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe("invalid_request_error");
      expect(res.body.error.message).toBe(
        "Missing required parameter: model",
      );
    });

    it("returns 400 when messages is missing", async () => {
      const res = await postChat({ model: "test-model" });
      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe("invalid_request_error");
      expect(res.body.error.message).toBe(
        "Missing or empty required parameter: messages",
      );
    });

    it("returns 400 when messages is empty array", async () => {
      const res = await postChat({ model: "test-model", messages: [] });
      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe("invalid_request_error");
      expect(res.body.error.message).toBe(
        "Missing or empty required parameter: messages",
      );
    });

    it("returns 400 when messages is not an array", async () => {
      const res = await postChat({
        model: "test-model",
        messages: "not-an-array",
      });
      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe("invalid_request_error");
      expect(res.body.error.message).toBe(
        "Missing or empty required parameter: messages",
      );
    });
  });

  describe("model resolution", () => {
    it("returns 404 when model not found in registry", async () => {
      vi.mocked(modelRegistry.lookup).mockReturnValue(null);

      const res = await postChat({
        model: "nonexistent-model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe("invalid_request_error");
      expect(res.body.error.code).toBe("model_not_found");
      expect(res.body.error.message).toContain("nonexistent-model");
      expect(res.body.error.message).toContain("GET /v1/models");
    });

    it("returns 404 when model does not support OpenAI", async () => {
      const handler = defaultHandler();
      handler.getOpenAIUrl.mockReturnValue(null as any);
      vi.mocked(modelRegistry.lookup).mockReturnValue({
        handler,
        modelConfig: defaultModelConfig(),
        providerConfig: defaultProviderConfig(),
      } as any);

      const res = await postChat({
        model: "anthropic-only-model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe("invalid_request_error");
      expect(res.body.error.code).toBe("model_not_found");
      expect(res.body.error.message).toContain(
        "does not support OpenAI chat completions",
      );
    });

    it("passes endpoint prefix from extractEndpointPrefix to lookup", async () => {
      vi.mocked(extractEndpointPrefix).mockReturnValue("/token-plan");
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeUpstreamResponse({ id: "r1", model: "m", choices: [] }),
      );

      await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });

      expect(modelRegistry.lookup).toHaveBeenCalledWith(
        "test-model",
        "/token-plan",
      );
    });
  });

  describe("successful non-streaming request", () => {
    it("responds with JSON and rewrites model to virtual model ID", async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeUpstreamResponse({
          id: "chatcmpl-1",
          model: "test-model-upstream",
          choices: [],
        }),
      );

      const res = await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(200);
      expect(res.body.model).toBe("test-model-virtual");
    });

    it("sets res.locals properties", async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeUpstreamResponse({ id: "r1", model: "m", choices: [] }),
      );

      await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });

      expect(generateRequestId).toHaveBeenCalled();
    });

    it("applies defaults and transforms request", async () => {
      const handler = defaultHandler();
      vi.mocked(modelRegistry.lookup).mockReturnValue({
        handler,
        modelConfig: defaultModelConfig(),
        providerConfig: defaultProviderConfig(),
      } as any);
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeUpstreamResponse({ id: "r1", model: "m", choices: [] }),
      );

      await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });

      expect(applyDefaults).toHaveBeenCalled();
      expect(handler.transformRequest).toHaveBeenCalled();
    });

    it("sends upstream model name in request body", async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeUpstreamResponse({ id: "r1", model: "m", choices: [] }),
      );

      await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });

      const fetchCall = vi.mocked(fetchWithTimeout).mock.calls[0]!;
      const sentBody = JSON.parse(fetchCall[1]!.body as string);
      expect(sentBody.model).toBe("test-model-upstream");
    });
  });

  describe("successful streaming request", () => {
    it("calls pipeSSEStream and sets X-Request-Id header", async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeStreamUpstreamResponse(),
      );
      vi.mocked(pipeSSEStream).mockImplementation(
        async (_upstream: any, clientRes: any) => {
          clientRes.setHeader("X-Request-Id", "test-req-123");
          clientRes.flushHeaders?.();
          clientRes.write('data: {"model":"m"}\n\n');
          clientRes.write("data: [DONE]\n\n");
          clientRes.end?.();
          return { inputTokens: 0, outputTokens: 0, cacheHit: false };
        },
      );

      const res = await postChatStreaming({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });
      expect(res.status).toBe(200);
      expect(pipeSSEStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "test-model-virtual",
        { skipEmptyLines: false, sendErrorChunk: false },
      );
    });

    it("sets res.locals for streaming requests", async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeStreamUpstreamResponse(),
      );
      vi.mocked(pipeSSEStream).mockImplementation(
        async (_upstream: any, clientRes: any) => {
          clientRes.write("data: [DONE]\n\n");
          clientRes.end?.();
          return { inputTokens: 0, outputTokens: 0, cacheHit: false };
        },
      );

      await postChatStreaming({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });

      expect(generateRequestId).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("returns 502 with rate_limit_error on timeout", async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(
        new Error("Request timed out after 120000ms"),
      );

      const res = await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(502);
      expect(res.body.error.type).toBe("rate_limit_error");
      expect(res.body.error.message).toBe(
        "Request to upstream API timed out",
      );
    });

    it("returns 502 with rate_limit_error when error contains 'timeout'", async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(
        new Error("connection timeout"),
      );

      const res = await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(502);
      expect(res.body.error.type).toBe("rate_limit_error");
    });

    it("returns 502 with upstream_error on fetch failure", async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(
        new Error("ECONNREFUSED"),
      );

      const res = await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(502);
      expect(res.body.error.type).toBe("upstream_error");
      expect(res.body.error.message).toContain("ECONNREFUSED");
    });

    it("returns 502 with upstream_error on non-Error rejection", async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue("string error");

      const res = await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(502);
      expect(res.body.error.type).toBe("upstream_error");
      expect(res.body.error.message).toContain("string error");
    });

    it("converts upstream non-2xx response with JSON error body", async () => {
      const errorBody = {
        error: {
          message: "Invalid API key",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      };
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeUpstreamResponse(errorBody, 401),
      );

      const res = await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe("Invalid API key");
      expect(res.body.error.type).toBe("authentication_error");
      expect(res.body.error.code).toBe("invalid_api_key");
    });

    it("converts upstream non-2xx response with flat message field", async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeUpstreamResponse({ message: "Rate limited" }, 429),
      );

      const res = await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(429);
      expect(res.body.error.message).toBe("Rate limited");
      expect(res.body.error.type).toBe("rate_limit_error");
    });

    it("handles upstream error body as non-object (string)", async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers({ "Content-Type": "text/plain" }),
        json: vi.fn().mockRejectedValue(new Error("not json")),
        text: vi.fn().mockResolvedValue("Internal Server Error"),
      } as unknown as Response);

      const res = await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(500);
      expect(res.body.error.type).toBe("upstream_error");
      expect(res.body.error.message).toBe("Internal Server Error");
    });

    it("falls back to status-based error type when upstream error has no type", async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeUpstreamResponse({ error: { message: "Forbidden" } }, 403),
      );

      const res = await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.status).toBe(403);
      expect(res.body.error.type).toBe("permission_error");
      expect(res.body.error.message).toBe("Forbidden");
    });
  });

  describe("auth headers", () => {
    it("constructs correct auth headers with provider config", async () => {
      const providerConfig = defaultProviderConfig();
      providerConfig.auth_header = "X-Custom-Auth";
      providerConfig.auth_prefix = "Token ";
      providerConfig.api_key = "my-secret-key";
      vi.mocked(modelRegistry.lookup).mockReturnValue({
        handler: defaultHandler(),
        modelConfig: defaultModelConfig(),
        providerConfig,
      } as any);
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeUpstreamResponse({ id: "r1", model: "m", choices: [] }),
      );

      await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });

      const fetchCall = vi.mocked(fetchWithTimeout).mock.calls[0]!;
      const headers = fetchCall[1]!.headers as Record<string, string>;
      expect(headers["X-Custom-Auth"]).toBe("Token my-secret-key");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["X-Request-Id"]).toBe("test-req-123");
    });

    it("sends auth header without prefix when prefix is empty", async () => {
      const providerConfig = defaultProviderConfig();
      providerConfig.auth_header = "Authorization";
      providerConfig.auth_prefix = "";
      providerConfig.api_key = "raw-key";
      vi.mocked(modelRegistry.lookup).mockReturnValue({
        handler: defaultHandler(),
        modelConfig: defaultModelConfig(),
        providerConfig,
      } as any);
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeUpstreamResponse({ id: "r1", model: "m", choices: [] }),
      );

      await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });

      const fetchCall = vi.mocked(fetchWithTimeout).mock.calls[0]!;
      const headers = fetchCall[1]!.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("raw-key");
    });

    it("includes Content-Type and X-Request-Id headers", async () => {
      vi.mocked(fetchWithTimeout).mockResolvedValue(
        makeUpstreamResponse({ id: "r1", model: "m", choices: [] }),
      );

      await postChat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      });

      const fetchCall = vi.mocked(fetchWithTimeout).mock.calls[0]!;
      const headers = fetchCall[1]!.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["X-Request-Id"]).toBe("test-req-123");
    });
  });
});
