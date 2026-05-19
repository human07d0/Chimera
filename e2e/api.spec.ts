/**
 * E2E API endpoint verification tests.
 *
 * Verifies the fixes applied in this session:
 *  - /health no longer leaks auth config status
 *  - /v1/endpoints requires auth when PROXY_API_KEY is configured
 *  - Chimera discovery correctly proxies models from upstream
 *  - Chat completion works through the proxy
 */
import { test, expect } from "@playwright/test";

const API_KEY = "sk-proxy";
const OPS_PASSWORD = "opspasswd";
const AUTH_HEADER = { Authorization: `Bearer ${API_KEY}` };

// ─── Health endpoint ───────────────────────────────────────────────

test.describe("GET /health", () => {
  test("returns 200 with status ok", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
    expect(body.totalModels).toBeGreaterThanOrEqual(0);
  });

  test("does NOT leak auth configuration status", async ({ request }) => {
    const res = await request.get("/health");
    const body = await res.json();

    // Regression: auth field must not be present
    expect(body).not.toHaveProperty("auth");
  });
});

// ─── Endpoints with auth protection ─────────────────────────────────

test.describe("GET /v1/endpoints", () => {
  test("returns 401 when no API key provided (auth enabled)", async ({
    request,
  }) => {
    const res = await request.get("/v1/endpoints");
    expect(res.status()).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe("missing_api_key");
  });

  test("returns 401 when wrong API key provided", async ({ request }) => {
    const res = await request.get("/v1/endpoints", {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_api_key");
  });

  test("returns 200 with endpoint list when valid API key provided", async ({
    request,
  }) => {
    const res = await request.get("/v1/endpoints", {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.endpoints).toBeInstanceOf(Array);
    expect(body.endpoints.length).toBeGreaterThan(0);

    // Each endpoint should have a prefix
    for (const ep of body.endpoints) {
      expect(ep).toHaveProperty("prefix");
      expect(typeof ep.prefix).toBe("string");
    }
  });
});

// ─── Model listing (chimera discovery) ──────────────────────────────

test.describe("GET /v1/models", () => {
  test("returns models discovered from upstream chimera", async ({
    request,
  }) => {
    const res = await request.get("/v1/models", {
      headers: AUTH_HEADER,
    });
    // Model listing is public (no auth required per endpoint registration order)
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.object).toBe("list");
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);

    // Verify model structure
    const firstModel = body.data[0];
    expect(firstModel).toHaveProperty("id");
    expect(firstModel).toHaveProperty("object", "model");
    expect(firstModel).toHaveProperty("owned_by");
  });

  test("returns model IDs from upstream chimera without prefix", async ({
    request,
  }) => {
    const res = await request.get("/v1/models", {
      headers: AUTH_HEADER,
    });
    const body = await res.json();

    const modelIds = body.data.map((m: any) => m.id);
    // Chimera handler is a no-op transform — model IDs are passed through as-is
    expect(modelIds).toContain("deepseek-v4-pro");
    expect(modelIds).toContain("deepseek-v4-flash");
  });
});

// ─── Chat completion through proxy ──────────────────────────────────

test.describe("POST /upstream/v1/chat/completions", () => {
  test("returns a valid chat completion response", async ({ request }) => {
    test.setTimeout(120000);
    const res = await request.post("/upstream/v1/chat/completions", {
      headers: {
        ...AUTH_HEADER,
        "Content-Type": "application/json",
      },
      data: {
        model: "deepseek-v4-flash",
        messages: [
          { role: "user", content: "Say 'hello world' in exactly 3 words." },
        ],
        max_tokens: 50,
        stream: false,
      },
      timeout: 60000,
    });

    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("choices");
    expect(body.choices).toBeInstanceOf(Array);
    expect(body.choices.length).toBeGreaterThan(0);
    expect(body.choices[0]).toHaveProperty("message");
    expect(body.choices[0].message).toHaveProperty("content");
    expect(typeof body.choices[0].message.content).toBe("string");
  });

  test("streaming chat completion works", async ({ request }) => {
    test.setTimeout(120000);
    const res = await request.post("/upstream/v1/chat/completions", {
      headers: {
        ...AUTH_HEADER,
        "Content-Type": "application/json",
      },
      data: {
        model: "deepseek-v4-flash",
        messages: [
          { role: "user", content: "Count from 1 to 3." },
        ],
        max_tokens: 30,
        stream: true,
      },
      timeout: 60000,
    });

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("data:");
    expect(text).toContain("[DONE]");
  });
});

// ─── Ops UI API routes ──────────────────────────────────────────────

test.describe("Ops UI /ops API routes", () => {
  const OPS_TOKEN = `Bearer ${OPS_PASSWORD}`;

  test("/ops/info returns enabled: true and version", async ({ request }) => {
    const res = await request.get("/ops/info");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(true);
    expect(body.data.version).toBeDefined();
  });

  test("/ops/status requires auth", async ({ request }) => {
    const noAuth = await request.get("/ops/status");
    expect(noAuth.status()).toBe(401);
  });

  test("/ops/status returns service info with valid auth", async ({
    request,
  }) => {
    const res = await request.get("/ops/status", {
      headers: { Authorization: OPS_TOKEN },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("uptime");
    expect(body.data).toHaveProperty("pid");
    expect(body.data).toHaveProperty("memory");
    expect(body.data).toHaveProperty("providers");
    expect(body.data.providers.length).toBeGreaterThan(0);
  });

  test("/ops/config returns current config with auth", async ({
    request,
  }) => {
    const res = await request.get("/ops/config", {
      headers: { Authorization: OPS_TOKEN },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("sensitive");
    // OPS_PASSWORD is configured, so hasOpsPassword should be true
    expect(body.data.sensitive.hasOpsPassword).toBe(true);
  });

  test("/ops/config/schema returns schema definition", async ({
    request,
  }) => {
    const res = await request.get("/ops/config/schema", {
      headers: { Authorization: OPS_TOKEN },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Schema should contain PORT and other required config fields
    expect(Object.keys(body.data).length).toBeGreaterThan(0);
  });
});

// ─── CORS and security headers ──────────────────────────────────────

test.describe("Security headers", () => {
  test("X-Content-Type-Options is set to nosniff", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });
});

// ─── Alternative auth methods ───────────────────────────────────────

test.describe("Authentication methods", () => {
  test("accepts api-key header", async ({ request }) => {
    const res = await request.get("/v1/endpoints", {
      headers: { "api-key": API_KEY },
    });
    expect(res.status()).toBe(200);
  });

  test("accepts x-api-key header", async ({ request }) => {
    const res = await request.get("/v1/endpoints", {
      headers: { "x-api-key": API_KEY },
    });
    expect(res.status()).toBe(200);
  });

  test("rejects empty api-key header", async ({ request }) => {
    const res = await request.get("/v1/endpoints", {
      headers: { "api-key": "" },
    });
    expect(res.status()).toBe(401);
  });
});

// ─── Anthropic messages endpoint ────────────────────────────────────

test.describe("POST /upstream/anthropic/v1/messages", () => {
    test("returns valid anthropic response with deepseek-v4-flash", async ({
    request,
  }) => {
    test.setTimeout(120000);
    const res = await request.post("/upstream/anthropic/v1/messages", {
      headers: {
        ...AUTH_HEADER,
        "Content-Type": "application/json",
      },
      data: {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Reply with exactly 3 words." }],
        max_tokens: 50,
      },
      timeout: 60000,
    });

    expect(res.status()).toBe(200);

    const body = await res.json();
    // Anthropic format: content is an array of blocks
    expect(body).toHaveProperty("content");
    expect(body.content).toBeInstanceOf(Array);
    expect(body.content.length).toBeGreaterThan(0);
    // Either text block or reasoning block
    const textBlocks = body.content.filter(
      (b: any) => b.type === "text" || b.type === "thinking",
    );
    expect(textBlocks.length).toBeGreaterThan(0);
  });

  test("returns anthropic-format error for missing model", async ({
    request,
  }) => {
    const res = await request.post("/upstream/anthropic/v1/messages", {
      headers: {
        ...AUTH_HEADER,
        "Content-Type": "application/json",
      },
      data: {
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 10,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.type).toContain("invalid_request");
  });
});

// ─── Anthropic streaming ────────────────────────────────────────────

test.describe("POST /upstream/anthropic/v1/messages (streaming)", () => {
  test("streaming returns valid SSE stream", async ({ request }) => {
    const res = await request.post("/upstream/anthropic/v1/messages", {
      headers: {
        ...AUTH_HEADER,
        "Content-Type": "application/json",
      },
      data: {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Say hello" }],
        max_tokens: 30,
        stream: true,
      },
      timeout: 60000,
    });

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/event-stream");

    const text = await res.text();
    // Anthropic SSE uses "event:" lines
    expect(text).toContain("event:");
    expect(text).toContain("data:");
  });
});

// ─── Reasoning model content structure ──────────────────────────────

test.describe("Reasoning model response structure", () => {
    test("deepseek-v4-flash returns reasoning_content in OpenAI format", async ({
    request,
  }) => {
    test.setTimeout(120000);
    const res = await request.post("/upstream/v1/chat/completions", {
      headers: {
        ...AUTH_HEADER,
        "Content-Type": "application/json",
      },
      data: {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "What is 1+1? Answer briefly." }],
        max_tokens: 100,
        stream: false,
      },
      timeout: 60000,
    });

    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.choices[0]).toHaveProperty("message");
    const msg = body.choices[0].message;
    // DeepSeek reasoning models may have empty content + reasoning_content
    expect(msg).toHaveProperty("reasoning_content");
    expect(typeof msg.reasoning_content).toBe("string");
    expect(msg.reasoning_content.length).toBeGreaterThan(0);
    // content may be empty string for reasoning models — that's expected
    expect(typeof msg.content).toBe("string");
    expect(body.choices[0]).toHaveProperty("finish_reason");
  });

    test("deepseek-v4-flash streaming includes reasoning_content in delta", async ({
    request,
  }) => {
    test.setTimeout(120000);
    const res = await request.post("/upstream/v1/chat/completions", {
      headers: {
        ...AUTH_HEADER,
        "Content-Type": "application/json",
      },
      data: {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "What is 2+2?" }],
        max_tokens: 50,
        stream: true,
      },
      timeout: 60000,
    });

    expect(res.status()).toBe(200);
    const text = await res.text();
    // Stream should contain reasoning_content in delta
    expect(text).toContain("reasoning_content");
  });
});

// ─── Chat with non-reasoning model (mimo-v2-flash) ──────────────────

test.describe("POST /upstream/v1/chat/completions with mimo-v2-flash", () => {
    test("returns content directly (non-reasoning model)", async ({
    request,
  }) => {
    test.setTimeout(120000);
    const res = await request.post("/upstream/v1/chat/completions", {
      headers: {
        ...AUTH_HEADER,
        "Content-Type": "application/json",
      },
      data: {
        model: "mimo-v2-flash",
        messages: [{ role: "user", content: "Say hi in one word." }],
        max_tokens: 20,
        stream: false,
      },
      timeout: 60000,
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    const content = body.choices[0].message.content;
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
    expect(body).toHaveProperty("usage");
    expect(body.usage).toHaveProperty("total_tokens");
  });
});

// ─── Invalid model error handling ───────────────────────────────────

test.describe("Invalid model error handling", () => {
  test("returns 404 for non-existent model on OpenAI route", async ({
    request,
  }) => {
    const res = await request.post("/upstream/v1/chat/completions", {
      headers: {
        ...AUTH_HEADER,
        "Content-Type": "application/json",
      },
      data: {
        model: "nonexistent-model-xyz",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 10,
      },
      timeout: 30000,
    });

    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("model_not_found");
  });

  test("returns 404 for non-existent model on Anthropic route", async ({
    request,
  }) => {
    const res = await request.post("/upstream/anthropic/v1/messages", {
      headers: {
        ...AUTH_HEADER,
        "Content-Type": "application/json",
      },
      data: {
        model: "nonexistent-model-xyz",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 10,
      },
      timeout: 30000,
    });

    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error.type).toBe("model_not_found");
  });
});

// ─── All endpoint prefixes ─────────────────────────────────────────

test.describe("Model listing on all endpoint prefixes", () => {
  test("root endpoint returns models", async ({ request }) => {
    const res = await request.get("/v1/models", { headers: AUTH_HEADER });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const ids = body.data.map((m: any) => m.id);
    expect(ids.length).toBeGreaterThan(0);
  });

  test("/token-plan prefix returns models", async ({ request }) => {
    const res = await request.get("/token-plan/v1/models", {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);
  });

  test("/upstream prefix returns models", async ({ request }) => {
    const res = await request.get("/upstream/v1/models", {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);
  });
});
