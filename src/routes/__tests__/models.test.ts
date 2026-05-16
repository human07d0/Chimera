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

vi.mock("../../providers/registry", () => ({
  modelRegistry: {
    getAllModels: vi.fn(),
    lookup: vi.fn(),
  },
}));

vi.mock("../endpointPrefix", () => ({
  extractEndpointPrefix: vi.fn(() => ""),
}));

import { modelsRouter } from "../models";
import { modelRegistry } from "../../providers/registry";
import { extractEndpointPrefix } from "../endpointPrefix";

let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(extractEndpointPrefix).mockReturnValue("");

  const app = express();
  app.use(express.json({ strict: false }));
  app.use("/v1", modelsRouter);

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

async function get(path: string): Promise<{
  status: number;
  body: any;
}> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode!, body: parsed });
      });
    }).on("error", reject);
  });
}

describe("GET /v1/models", () => {
  it("returns list with architecture field containing modalities", async () => {
    vi.mocked(modelRegistry.getAllModels).mockReturnValue([
      {
        model: {
          id: "gpt-4",
          context_length: 8192,
          max_output_tokens: 4096,
          upstream: "gpt-4",
          description: "GPT-4 model",
          created: 1687882411,
          capabilities: { vision: true },
          modalities: { input: ["text", "image"], output: ["text"] },
        },
        providerName: "openai",
        providerType: "openai",
      },
      {
        model: {
          id: "claude-3",
          context_length: 200000,
          max_output_tokens: 4096,
          upstream: "claude-3",
          description: "Claude 3 model",
          created: 1708992000,
          modalities: { input: ["text", "image"], output: ["text"] },
        },
        providerName: "anthropic",
        providerType: "anthropic",
      },
    ]);

    const res = await get("/v1/models");

    expect(res.status).toBe(200);
    expect(res.body.object).toBe("list");
    expect(res.body.data).toHaveLength(2);

    const gpt4 = res.body.data[0];
    expect(gpt4.id).toBe("gpt-4");
    expect(gpt4.architecture).toEqual({
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    });

    const claude = res.body.data[1];
    expect(claude.id).toBe("claude-3");
    expect(claude.architecture).toEqual({
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    });
  });

  it("defaults modalities to ['text'] when modalities is undefined", async () => {
    vi.mocked(modelRegistry.getAllModels).mockReturnValue([
      {
        model: {
          id: "text-only",
          context_length: 4096,
          max_output_tokens: 1024,
          upstream: "text-only",
        },
        providerName: "test-provider",
        providerType: "test",
      },
    ]);

    const res = await get("/v1/models");

    expect(res.status).toBe(200);
    expect(res.body.data[0].architecture).toEqual({
      input_modalities: ["text"],
      output_modalities: ["text"],
    });
  });

  it("defaults individual modalities when partially defined", async () => {
    vi.mocked(modelRegistry.getAllModels).mockReturnValue([
      {
        model: {
          id: "partial",
          context_length: 4096,
          max_output_tokens: 1024,
          upstream: "partial",
          modalities: { input: ["text", "image"], output: [] as string[] },
        },
        providerName: "test-provider",
        providerType: "test",
      },
    ]);

    const res = await get("/v1/models");

    expect(res.body.data[0].architecture).toEqual({
      input_modalities: ["text", "image"],
      output_modalities: [],
    });
  });

  it("includes pricing when available alongside architecture", async () => {
    vi.mocked(modelRegistry.getAllModels).mockReturnValue([
      {
        model: {
          id: "priced-model",
          context_length: 4096,
          max_output_tokens: 1024,
          upstream: "priced-model",
          pricing: { input: 0.001, output: 0.002 },
        },
        providerName: "test-provider",
        providerType: "test",
      },
    ]);

    const res = await get("/v1/models");

    expect(res.body.data[0].pricing).toEqual({ input: 0.001, output: 0.002 });
    expect(res.body.data[0].architecture).toEqual({
      input_modalities: ["text"],
      output_modalities: ["text"],
    });
  });
});

describe("GET /v1/models/:modelId", () => {
  it("returns single model with architecture field containing modalities", async () => {
    vi.mocked(modelRegistry.lookup).mockReturnValue({
      handler: {
        type: "openai",
        getOpenAIUrl: vi.fn(),
        getAnthropicUrl: vi.fn(),
        getDefaultBaseUrl: vi.fn(),
        getDefaultAnthropicUrl: vi.fn(),
        transformRequest: vi.fn(),
      },
      providerConfig: {
        version: 1,
        type: "openai",
        name: "openai",
        api_key: "sk-test",
        base_url: "https://api.openai.com",
        anthropic_url: null,
        auth_header: "Authorization",
        auth_prefix: "Bearer ",
        timeout: 120000,
        endpoint: "",
        models: [],
        capabilities: {},
        web_search: null,
      },
      modelConfig: {
        id: "gpt-4",
        context_length: 8192,
        max_output_tokens: 4096,
        upstream: "gpt-4",
        description: "GPT-4 model",
        created: 1687882411,
        capabilities: { vision: true, function_calling: true },
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    } as any);

    const res = await get("/v1/models/gpt-4");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("gpt-4");
    expect(res.body.object).toBe("model");
    expect(res.body.owned_by).toBe("openai");
    expect(res.body.capabilities).toEqual({ vision: true, function_calling: true });
    expect(res.body.architecture).toEqual({
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    });
  });

  it("returns single model with default text modalities when undefined", async () => {
    vi.mocked(modelRegistry.lookup).mockReturnValue({
      handler: {
        type: "openai",
        getOpenAIUrl: vi.fn(),
        getAnthropicUrl: vi.fn(),
        getDefaultBaseUrl: vi.fn(),
        getDefaultAnthropicUrl: vi.fn(),
        transformRequest: vi.fn(),
      },
      providerConfig: {
        version: 1,
        type: "test",
        name: "test-provider",
        api_key: "sk-test",
        base_url: "https://api.test.com",
        anthropic_url: null,
        auth_header: "Authorization",
        auth_prefix: "Bearer ",
        timeout: 120000,
        endpoint: "",
        models: [],
        capabilities: {},
        web_search: null,
      },
      modelConfig: {
        id: "simple-model",
        context_length: 4096,
        max_output_tokens: 1024,
        upstream: "simple-model",
      },
    } as any);

    const res = await get("/v1/models/simple-model");

    expect(res.status).toBe(200);
    expect(res.body.architecture).toEqual({
      input_modalities: ["text"],
      output_modalities: ["text"],
    });
  });

  it("returns 404 for unknown model", async () => {
    vi.mocked(modelRegistry.lookup).mockReturnValue(null);

    const res = await get("/v1/models/unknown");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("model_not_found");
  });
});
