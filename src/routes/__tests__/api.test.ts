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
    getEndpoints: vi.fn(),
    getProviders: vi.fn(),
  },
}));

import { apiRouter } from "../api";
import { modelRegistry } from "../../providers/registry";

let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  vi.clearAllMocks();

  const app = express();
  app.use(express.json({ strict: false }));
  app.use(apiRouter);

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

async function get(path: string): Promise<{ status: number; body: any }> {
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

describe("GET /api", () => {
  it("includes provider names in descriptions for default endpoint", async () => {
    vi.mocked(modelRegistry.getEndpoints).mockReturnValue([""]);
    vi.mocked(modelRegistry.getProviders).mockReturnValue([
      { name: "mimo", endpoint: "" } as any,
      { name: "deepseek", endpoint: "" } as any,
    ]);

    const res = await get("/api");

    expect(res.status).toBe(200);
    const chatEndpoint = res.body.endpoints.find(
      (e: any) => e.path === "/v1/chat/completions"
    );
    expect(chatEndpoint).toBeDefined();
    expect(chatEndpoint.description).toBe(
      "Chat completions (OpenAI compatible) (providers: mimo, deepseek)"
    );
  });

  it("includes provider name in description for custom endpoint", async () => {
    vi.mocked(modelRegistry.getEndpoints).mockReturnValue(["/token-plan"]);
    vi.mocked(modelRegistry.getProviders).mockReturnValue([
      { name: "mimo-token-plan-cn", endpoint: "/token-plan" } as any,
    ]);

    const res = await get("/api");

    expect(res.status).toBe(200);
    const chatEndpoint = res.body.endpoints.find(
      (e: any) => e.path === "/token-plan/v1/chat/completions"
    );
    expect(chatEndpoint).toBeDefined();
    expect(chatEndpoint.description).toBe(
      "Chat completions (OpenAI compatible) (providers: mimo-token-plan-cn)"
    );
  });

  it("groups multiple providers under same endpoint", async () => {
    vi.mocked(modelRegistry.getEndpoints).mockReturnValue(["/team"]);
    vi.mocked(modelRegistry.getProviders).mockReturnValue([
      { name: "provider-a", endpoint: "/team" } as any,
      { name: "provider-b", endpoint: "/team" } as any,
      { name: "provider-c", endpoint: "/team" } as any,
    ]);

    const res = await get("/api");

    const chatEndpoint = res.body.endpoints.find(
      (e: any) => e.path === "/team/v1/chat/completions"
    );
    expect(chatEndpoint.description).toBe(
      "Chat completions (OpenAI compatible) (providers: provider-a, provider-b, provider-c)"
    );
  });

  it("no providers results in no provider suffix", async () => {
    vi.mocked(modelRegistry.getEndpoints).mockReturnValue([""]);
    vi.mocked(modelRegistry.getProviders).mockReturnValue([]);

    const res = await get("/api");

    const chatEndpoint = res.body.endpoints.find(
      (e: any) => e.path === "/v1/chat/completions"
    );
    expect(chatEndpoint.description).toBe("Chat completions (OpenAI compatible)");
  });
});
