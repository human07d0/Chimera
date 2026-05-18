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
  },
}));

import { endpointsRouter } from "../endpoints";
import { modelRegistry } from "../../providers/registry";

let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  vi.clearAllMocks();

  const app = express();
  app.use(express.json({ strict: false }));
  app.use("/v1", endpointsRouter);

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

describe("GET /v1/endpoints", () => {
  it("returns object:list with endpoints array", async () => {
    vi.mocked(modelRegistry.getEndpoints).mockReturnValue(["", "/team-a", "/research"]);

    const res = await get("/v1/endpoints");

    expect(res.status).toBe(200);
    expect(res.body.object).toBe("list");
    expect(res.body.endpoints).toHaveLength(3);
  });

  it("each endpoint has prefix and path fields", async () => {
    vi.mocked(modelRegistry.getEndpoints).mockReturnValue(["", "/gw"]);

    const res = await get("/v1/endpoints");

    const defaultEp = res.body.endpoints[0];
    expect(defaultEp.prefix).toBe("");
    expect(defaultEp.path).toBe("/v1");

    const customEp = res.body.endpoints[1];
    expect(customEp.prefix).toBe("/gw");
    expect(customEp.path).toBe("/gw/v1");
  });

  it("returns empty endpoints array when no endpoints registered", async () => {
    vi.mocked(modelRegistry.getEndpoints).mockReturnValue([]);

    const res = await get("/v1/endpoints");

    expect(res.status).toBe(200);
    expect(res.body.object).toBe("list");
    expect(res.body.endpoints).toEqual([]);
  });
});
