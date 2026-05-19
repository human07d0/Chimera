import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../utils/fetchWithTimeout", () => ({
  fetchWithTimeout: vi.fn(),
}));

import { loadProviders, normalizeEndpoint, resolveEnvVars, computeLocalPrefix, normalizeBaseUrl } from "../loader";
import { logger } from "../../utils/logger";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout";

let tmpDir: string;

const envVarsToClean: string[] = [];

function setTestEnv(key: string, value: string): void {
  if (!(key in process.env)) envVarsToClean.push(key);
  process.env[key] = value;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loader-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const key of envVarsToClean) {
    delete process.env[key];
  }
  envVarsToClean.length = 0;
  vi.restoreAllMocks();
});

function writeYaml(name: string, content: string): void {
  fs.writeFileSync(path.join(tmpDir, name), content, "utf-8");
}

const MINIMAL_PROVIDER = `
version: 1
type: mimo
api_key: test-key
auth_header: Authorization
auth_prefix: "Bearer "
models:
  - id: model-a
    upstream: model-a
    context_length: 100000
    max_output_tokens: 8000
`;

describe("normalizeEndpoint", () => {
  it("returns empty string for empty input", async () => {
    expect(normalizeEndpoint("")).toBe("");
  });

  it("strips leading slashes", async () => {
    expect(normalizeEndpoint("/v1/chat")).toBe("/v1/chat");
  });

  it("strips trailing slashes", async () => {
    expect(normalizeEndpoint("v1/chat/")).toBe("/v1/chat");
  });

  it("strips both leading and trailing slashes", async () => {
    expect(normalizeEndpoint("/v1/chat/")).toBe("/v1/chat");
  });

  it("collapses bare slash to empty", async () => {
    expect(normalizeEndpoint("/")).toBe("");
  });

  it("collapses multiple slashes to empty", async () => {
    expect(normalizeEndpoint("///")).toBe("");
  });

  it("handles path without leading slash", async () => {
    expect(normalizeEndpoint("v1/chat")).toBe("/v1/chat");
  });
});

describe("resolveEnvVars", () => {
  it("resolves single variable", async () => {
    setTestEnv("TEST_LOADER_VAR", "hello");
    expect(resolveEnvVars("${TEST_LOADER_VAR}")).toBe("hello");
  });

  it("resolves multiple variables in one string", async () => {
    setTestEnv("A", "foo");
    setTestEnv("B", "bar");
    expect(resolveEnvVars("${A}-${B}")).toBe("foo-bar");
  });

  it("preserves text around variables", async () => {
    setTestEnv("KEY", "secret");
    expect(resolveEnvVars("Bearer ${KEY}")).toBe("Bearer secret");
  });

  it("returns empty string for missing variable", async () => {
    delete process.env["MISSING"];
    expect(resolveEnvVars("${MISSING}")).toBe("");
  });

  it("resolves empty string env var to empty string", async () => {
    setTestEnv("EMPTY", "");
    expect(resolveEnvVars("${EMPTY}")).toBe("");
  });
});

describe("loadProviders", () => {
  it("loads a valid minimal provider", async () => {
    writeYaml("test.yaml", MINIMAL_PROVIDER);
    const providers = await loadProviders(tmpDir);
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("test");
    expect(providers[0]!.type).toBe("mimo");
    expect(providers[0]!.api_key).toBe("test-key");
    expect(providers[0]!.auth_header).toBe("Authorization");
    expect(providers[0]!.auth_prefix).toBe("Bearer ");
    expect(providers[0]!.models).toHaveLength(1);
    expect(providers[0]!.models[0]!.id).toBe("model-a");
  });

  it("applies default values for optional fields", async () => {
    writeYaml("test.yaml", MINIMAL_PROVIDER);
    const providers = await loadProviders(tmpDir);
    const p = providers[0]!;
    expect(p.timeout).toBe(120000);
    expect(p.endpoint).toBe("");
    expect(p.capabilities).toEqual({});
    expect(p.web_search).toBeNull();
    expect(p.base_url).toBe("https://api.xiaomimimo.com");
    expect(p.anthropic_url).toBe("https://api.xiaomimimo.com/anthropic");
  });

  it("generates description from id when absent", async () => {
    writeYaml("test.yaml", MINIMAL_PROVIDER);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.description).toBe("model-a");
  });

  it("uses provided description when present", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
    description: My Model
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.description).toBe("My Model");
  });

  it("sets created to load time when absent", async () => {
    const before = Math.floor(Date.now() / 1000);
    writeYaml("test.yaml", MINIMAL_PROVIDER);
    const providers = await loadProviders(tmpDir);
    const after = Math.floor(Date.now() / 1000);
    expect(providers[0]!.models[0]!.created).toBeGreaterThanOrEqual(before);
    expect(providers[0]!.models[0]!.created).toBeLessThanOrEqual(after);
  });

  it("uses provided created when present", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
    created: 1700000000
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.created).toBe(1700000000);
  });

  it("resolves ${VAR} references in api_key", async () => {
    setTestEnv("MY_API_KEY", "resolved-key");
    const yaml = `
version: 1
type: mimo
api_key: \${MY_API_KEY}
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.api_key).toBe("resolved-key");
  });

  it("resolves ${VAR} in nested model fields", async () => {
    setTestEnv("MODEL_ID", "resolved-id");
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: \${MODEL_ID}
    upstream: \${MODEL_ID}
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.id).toBe("resolved-id");
  });

  it("loads provider with empty api_key when env var is missing", async () => {
    delete process.env["NONEXISTENT_VAR"];
    const yaml = `
version: 1
type: mimo
api_key: \${NONEXISTENT_VAR}
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers).toHaveLength(1);
    expect(providers[0]!.api_key).toBe("");
  });

  it("loads provider with empty api_key when env var is empty string", async () => {
    setTestEnv("EMPTY_KEY", "");
    const yaml = `
version: 1
type: mimo
api_key: "\${EMPTY_KEY}"
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers).toHaveLength(1);
    expect(providers[0]!.api_key).toBe("");
  });

  it("skips provider not in enabledProviderNames set", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir, new Set(["other"]));
    expect(providers).toHaveLength(0);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("not in ENABLED_PROVIDERS"),
    );
  });

  it("loads provider in enabledProviderNames set", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir, new Set(["test"]));
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("test");
  });

  it("loads all providers when enabledProviderNames is null", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir, null);
    expect(providers).toHaveLength(1);
  });

  it("throws on malformed YAML", async () => {
    writeYaml("bad.yaml", ":\n  - :\n  invalid: [yaml");
    await expect(loadProviders(tmpDir)).rejects.toThrow("Failed to parse YAML file");
  });

  it("throws on unknown type", async () => {
    const yaml = `
version: 1
type: unknown_handler
api_key: k
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow();
  });

  it("throws on version != 1", async () => {
    const yaml = `
version: 2
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow();
  });

  it("throws on default.max_tokens", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
    default:
      max_tokens: 100
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow("default.max_tokens is not allowed");
  });

  it("allows default.max_tokens for non-MiMo providers (e.g. deepseek)", async () => {
    const yaml = `
version: 1
type: deepseek
api_key: k
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
    default:
      max_tokens: 100
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).resolves.not.toThrow();
  });
});

describe("chimera provider type", () => {
  const CHIMERA_MINIMAL = `
version: 1
type: chimera
base_url: http://upstream:3000
api_key: test-key
`;

  it("validates minimal chimera YAML (no models required)", async () => {
    writeYaml("test.yaml", CHIMERA_MINIMAL);
    const providers = await loadProviders(tmpDir);
    expect(providers).toHaveLength(0);
  });

  it("rejects chimera YAML without base_url", async () => {
    const yaml = `
version: 1
type: chimera
api_key: test-key
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow("Invalid");
  });

  it("rejects chimera YAML with models field (strict mode)", async () => {
    const yaml = `
version: 1
type: chimera
base_url: http://upstream:3000
api_key: test-key
models:
  - id: manual-model
    upstream: manual-model
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow("Invalid");
  });

  it("applies default auth_header for chimera when omitted", async () => {
    writeYaml("test.yaml", CHIMERA_MINIMAL);
    await expect(loadProviders(tmpDir)).resolves.not.toThrow();
  });

  it("allows explicit auth_header override for chimera", async () => {
    const yaml = `
version: 1
type: chimera
base_url: http://upstream:3000
api_key: test-key
auth_header: x-api-key
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).resolves.not.toThrow();
  });

  it("uses configured auth_header and auth_prefix in discovery requests", async () => {
    const { fetchWithTimeout } = await import("../../utils/fetchWithTimeout");
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ endpoints: [{ prefix: "" }] }),
    } as any);

    const yaml = `
version: 1
type: chimera
base_url: http://upstream:3000
api_key: test-key
auth_header: x-api-key
auth_prefix: "Api-Key "
`;
    writeYaml("test.yaml", yaml);
    await loadProviders(tmpDir);

    const endpointsCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("/v1/endpoints"),
    );
    expect(endpointsCall).toBeDefined();
    expect(endpointsCall![1]).toEqual({
      headers: { "x-api-key": "Api-Key test-key" },
    });
  });

  it("uses default Bearer auth_prefix when auth_prefix omitted", async () => {
    const { fetchWithTimeout } = await import("../../utils/fetchWithTimeout");
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ endpoints: [{ prefix: "" }] }),
    } as any);

    writeYaml("test.yaml", CHIMERA_MINIMAL);
    await loadProviders(tmpDir);

    const endpointsCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("/v1/endpoints"),
    );
    expect(endpointsCall).toBeDefined();
    expect(endpointsCall![1]).toEqual({
      headers: { Authorization: "Bearer test-key" },
    });
  });

  it("passes auth_header and auth_prefix to fetchModels", async () => {
    const { fetchWithTimeout } = await import("../../utils/fetchWithTimeout");
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/v1/endpoints")) {
        return { ok: true, status: 200, json: async () => ({ endpoints: [{ prefix: "" }] }) } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: "m1", context_length: 1000, max_output_tokens: 500 }],
        }),
      } as any;
    });

    const yaml = `
version: 1
type: chimera
base_url: http://upstream:3000
api_key: my-key
auth_header: x-api-key
auth_prefix: "Token "
`;
    writeYaml("test.yaml", yaml);
    await loadProviders(tmpDir);

    const modelsCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("/v1/models"),
    );
    expect(modelsCall).toBeDefined();
    expect(modelsCall![1]).toEqual({
      headers: { "x-api-key": "Token my-key" },
    });
  });

  it("logs error details when model discovery fails", async () => {
    const { fetchWithTimeout } = await import("../../utils/fetchWithTimeout");
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/v1/endpoints")) {
        return { ok: true, status: 200, json: async () => ({ endpoints: [{ prefix: "" }] }) } as any;
      }
      throw new Error("connection refused");
    });

    writeYaml("test.yaml", CHIMERA_MINIMAL);
    await loadProviders(tmpDir);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("failed to discover models"),
      expect.objectContaining({ error: "connection refused" }),
    );
  });

  it("rejects chimera YAML with capabilities field (strict mode)", async () => {
    const yaml = `
version: 1
type: chimera
base_url: http://upstream:3000
api_key: test-key
capabilities:
  thinking: true
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow("Invalid");
  });

  it("rejects chimera YAML with web_search field (strict mode)", async () => {
    const yaml = `
version: 1
type: chimera
base_url: http://upstream:3000
api_key: test-key
web_search:
  maxKeyword: 3
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow("Invalid");
  });

  it("throws when fetchModels returns non-array data", async () => {
    const { fetchWithTimeout } = await import("../../utils/fetchWithTimeout");
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/v1/endpoints")) {
        return { ok: true, status: 200, json: async () => ({ endpoints: [{ prefix: "" }] }) } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: "not-an-array" }),
      } as any;
    });

    writeYaml("test.yaml", CHIMERA_MINIMAL);
    const providers = await loadProviders(tmpDir);
    expect(providers).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("failed to discover models"),
      expect.objectContaining({ error: expect.stringContaining("array") }),
    );
  });
});

describe("chimera discovery flow", () => {
  const CHIMERA_YAML = `
version: 1
type: chimera
base_url: http://upstream:3000
api_key: test-key
`;

  function mockEndpointsResponse(prefixes: string[]) {
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ endpoints: prefixes.map(p => ({ prefix: p })) }),
    } as any);
  }

  function mockEndpoints404() {
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockResolvedValueOnce({
      status: 404,
      ok: false,
      json: async () => ({}),
    } as any);
  }

  function mockEndpointsError(msg: string) {
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockRejectedValueOnce(new Error(msg));
  }

  function mockModelsResponse(models: Array<{ id: string; context_length: number; max_output_tokens: number }>) {
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ data: models }),
    } as any);
  }

  function mockModelsError(msg: string) {
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockRejectedValueOnce(new Error(msg));
  }

  it("discovers providers from chimera upstream", async () => {
    mockEndpointsResponse(["v1", "v2"]);
    mockModelsResponse([{ id: "model-a", context_length: 1000, max_output_tokens: 500 }]);
    mockModelsResponse([{ id: "model-b", context_length: 2000, max_output_tokens: 1000 }]);

    writeYaml("test.yaml", CHIMERA_YAML);
    const providers = await loadProviders(tmpDir);

    expect(providers).toHaveLength(2);
    expect(providers[0]!.name).toBe("test/v1");
    expect(providers[0]!.endpoint).toBe("/v1");
    expect(providers[0]!.models).toHaveLength(1);
    expect(providers[0]!.models[0]!.id).toBe("model-a");
    expect(providers[0]!.type).toBe("chimera");

    expect(providers[1]!.name).toBe("test/v2");
    expect(providers[1]!.endpoint).toBe("/v2");
    expect(providers[1]!.models).toHaveLength(1);
    expect(providers[1]!.models[0]!.id).toBe("model-b");
  });

  it("falls back to single endpoint when /v1/endpoints returns 404", async () => {
    mockEndpoints404();
    mockModelsResponse([{ id: "model-a", context_length: 1000, max_output_tokens: 500 }]);

    writeYaml("test.yaml", CHIMERA_YAML);
    const providers = await loadProviders(tmpDir);

    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("test");
    expect(providers[0]!.endpoint).toBe("");
    expect(providers[0]!.models).toHaveLength(1);
    expect(providers[0]!.models[0]!.id).toBe("model-a");
  });

  it("skips provider when fetchEndpoints throws network error", async () => {
    mockEndpointsError("Network failure");

    writeYaml("test.yaml", CHIMERA_YAML);
    const providers = await loadProviders(tmpDir);

    expect(providers).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("failed to discover endpoints"),
      expect.objectContaining({ error: "Network failure" }),
    );
  });

  it("skips prefix when fetchModels fails for that prefix", async () => {
    mockEndpointsResponse(["v1", "v2"]);
    mockModelsResponse([{ id: "model-a", context_length: 1000, max_output_tokens: 500 }]);
    mockModelsError("Prefix v2 models fetch failed");

    writeYaml("test.yaml", CHIMERA_YAML);
    const providers = await loadProviders(tmpDir);

    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("test/v1");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("failed to discover models at 'v2'"),
      expect.objectContaining({ error: "Prefix v2 models fetch failed" }),
    );
  });

  it("skips endpoint when fetchModels returns empty model array", async () => {
    mockEndpointsResponse(["v1", "v2"]);
    mockModelsResponse([{ id: "model-a", context_length: 1000, max_output_tokens: 500 }]);
    mockModelsResponse([]);

    writeYaml("test.yaml", CHIMERA_YAML);
    const providers = await loadProviders(tmpDir);

    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("test/v1");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no models at 'v2'"),
    );
  });

  it("computes local prefix when config has empty endpoint and upstream has prefix", async () => {
    mockEndpointsResponse(["chat"]);
    mockModelsResponse([{ id: "model-a", context_length: 1000, max_output_tokens: 500 }]);

    writeYaml("test.yaml", CHIMERA_YAML);
    const providers = await loadProviders(tmpDir);

    expect(providers).toHaveLength(1);
    expect(providers[0]!.endpoint).toBe("/chat");
  });

  it("computes local prefix when config has endpoint and upstream prefix is empty", async () => {
    mockEndpoints404();
    mockModelsResponse([{ id: "model-a", context_length: 1000, max_output_tokens: 500 }]);

    const yaml = `
version: 1
type: chimera
base_url: http://upstream:3000
api_key: test-key
endpoint: /custom
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);

    expect(providers).toHaveLength(1);
    expect(providers[0]!.endpoint).toBe("/custom");
  });

  it("computes local prefix when both config endpoint and upstream prefix are set", async () => {
    mockEndpointsResponse(["chat"]);
    mockModelsResponse([{ id: "model-a", context_length: 1000, max_output_tokens: 500 }]);

    const yaml = `
version: 1
type: chimera
base_url: http://upstream:3000
api_key: test-key
endpoint: /custom
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);

    expect(providers).toHaveLength(1);
    expect(providers[0]!.endpoint).toBe("/custom/chat");
  });

  it("computes local prefix when both config endpoint and upstream prefix are empty", async () => {
    mockEndpoints404();
    mockModelsResponse([{ id: "model-a", context_length: 1000, max_output_tokens: 500 }]);

    writeYaml("test.yaml", CHIMERA_YAML);
    const providers = await loadProviders(tmpDir);

    expect(providers).toHaveLength(1);
    expect(providers[0]!.endpoint).toBe("");
  });

  it("joinUrl removes duplicate slashes in paths", async () => {
    const yaml = `
version: 1
type: chimera
base_url: http://upstream:3000/
api_key: test-key
endpoint: //v1//chat//
`;
    mockEndpointsResponse(["chat"]);
    mockModelsResponse([{ id: "model-a", context_length: 1000, max_output_tokens: 500 }]);

    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);

    expect(providers).toHaveLength(1);
    expect(providers[0]!.base_url).toBe("http://upstream:3000/chat");
  });
});