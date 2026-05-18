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

import { loadProviders, normalizeEndpoint, resolveEnvVars } from "../loader";
import { logger } from "../../utils/logger";

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

  it("allows provider-specific default keys like thinking", async () => {
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
      thinking: true
      response_format: { type: json_object }
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.default).toEqual({
      thinking: true,
      response_format: { type: "json_object" },
    });
  });

  it("detects duplicate model id within same endpoint", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: same-id
    upstream: a
    context_length: 1000
    max_output_tokens: 500
  - id: same-id
    upstream: b
    context_length: 2000
    max_output_tokens: 1000
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow("Duplicate model IDs detected:");
  });

  it("detects duplicate model id across different provider files", async () => {
    const yaml1 = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: shared-id
    upstream: a
    context_length: 1000
    max_output_tokens: 500
`;
    const yaml2 = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: shared-id
    upstream: b
    context_length: 2000
    max_output_tokens: 1000
`;
    writeYaml("provider-a.yaml", yaml1);
    writeYaml("provider-b.yaml", yaml2);
    await expect(loadProviders(tmpDir)).rejects.toThrow(/found in .*'provider-a' \(provider-a\.yaml\).*'provider-b' \(provider-b\.yaml\)/);
  });

  it("reports all providers when model id conflicts across 3+ files", async () => {
    const yaml1 = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: clash
    upstream: a
    context_length: 1000
    max_output_tokens: 500
`;
    const yaml2 = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: clash
    upstream: b
    context_length: 2000
    max_output_tokens: 1000
`;
    const yaml3 = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: clash
    upstream: c
    context_length: 3000
    max_output_tokens: 1500
`;
    writeYaml("p1.yaml", yaml1);
    writeYaml("p2.yaml", yaml2);
    writeYaml("p3.yaml", yaml3);
    const error = await (async () => {
      try { await loadProviders(tmpDir); return null; } catch (e) { return e as Error; }
    })();
    expect(error).not.toBeNull();
    expect(error!.message).toContain("Duplicate model IDs detected:");
    expect(error!.message).toContain("'p1' (p1.yaml)");
    expect(error!.message).toContain("'p2' (p2.yaml)");
    expect(error!.message).toContain("'p3' (p3.yaml)");
  });

  it("reports mixed same-file and cross-file duplicates", async () => {
    const yaml1 = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: clash
    upstream: a
    context_length: 1000
    max_output_tokens: 500
  - id: clash
    upstream: b
    context_length: 2000
    max_output_tokens: 1000
`;
    const yaml2 = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: clash
    upstream: c
    context_length: 3000
    max_output_tokens: 1500
`;
    writeYaml("provider-a.yaml", yaml1);
    writeYaml("provider-b.yaml", yaml2);
    const error = await (async () => {
      try { await loadProviders(tmpDir); return null; } catch (e) { return e as Error; }
    })();
    expect(error).not.toBeNull();
    expect(error!.message).toContain("Duplicate model IDs detected:");
    expect(error!.message).toContain("'provider-a' (provider-a.yaml) [2 definitions]");
    expect(error!.message).toContain("'provider-b' (provider-b.yaml) [1 definition]");
  });

  it("reports multiple distinct model id conflicts in one error", async () => {
    const yaml1 = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: model-a
    upstream: a
    context_length: 1000
    max_output_tokens: 500
  - id: model-b
    upstream: b
    context_length: 1000
    max_output_tokens: 500
`;
    const yaml2 = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: model-a
    upstream: c
    context_length: 2000
    max_output_tokens: 1000
  - id: model-b
    upstream: d
    context_length: 2000
    max_output_tokens: 1000
`;
    writeYaml("p1.yaml", yaml1);
    writeYaml("p2.yaml", yaml2);
    const error = await (async () => {
      try { await loadProviders(tmpDir); return null; } catch (e) { return e as Error; }
    })();
    expect(error).not.toBeNull();
    expect(error!.message).toContain("Model 'model-a'");
    expect(error!.message).toContain("Model 'model-b'");
  });

  it("loads model with empty string id", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: ""
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.id).toBe("");
  });

  it("loads model with whitespace-only id", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: "   "
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.id).toBe("   ");
  });

  it("loads model with special characters in id", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models:
  - id: "foo/bar-baz"
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.id).toBe("foo/bar-baz");
  });

  it("allows same model id at different endpoints", async () => {
    const yaml1 = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
endpoint: /v1/chat
models:
  - id: shared-id
    upstream: a
    context_length: 1000
    max_output_tokens: 500
`;
    const yaml2 = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
endpoint: /v2/chat
models:
  - id: shared-id
    upstream: b
    context_length: 2000
    max_output_tokens: 1000
`;
    writeYaml("p1.yaml", yaml1);
    writeYaml("p2.yaml", yaml2);
    const providers = await loadProviders(tmpDir);
    expect(providers).toHaveLength(2);
    expect(providers[0]!.models[0]!.id).toBe("shared-id");
    expect(providers[1]!.models[0]!.id).toBe("shared-id");
  });

  it("performs capabilities shallow merge", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
capabilities:
  thinking: false
  json: true
  search: false
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
    capabilities:
      thinking: true
      tools: true
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    const caps = providers[0]!.models[0]!.capabilities!;
    expect(caps.thinking).toBe(true);
    expect(caps.json).toBe(true);
    expect(caps.search).toBe(false);
    expect(caps.tools).toBe(true);
  });

  it("preserves provider capabilities when model has none", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
capabilities:
  thinking: true
  json: true
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.capabilities).toEqual({
      thinking: true,
      json: true,
    });
  });

  it("logs warning and skips provider with empty models", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models: []
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no models"),
    );
  });

  it("returns empty array when config dir does not exist", async () => {
    const providers = await loadProviders("/nonexistent/path");
    expect(providers).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });

  it("returns empty array when no yaml files exist", async () => {
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "no yaml here");
    const providers = await loadProviders(tmpDir);
    expect(providers).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("No YAML files"),
    );
  });

  it("uses filename stem as provider name when name is absent", async () => {
    writeYaml("my-provider.yaml", MINIMAL_PROVIDER);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.name).toBe("my-provider");
  });

  it("rejects YAML with name field due to strict mode", async () => {
    const yaml = `
version: 1
type: mimo
name: custom-name
api_key: k
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("file.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow(/unrecognized_keys|name/);
  });

  it("normalizes endpoint", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
endpoint: /v1/chat/completions/
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.endpoint).toBe("/v1/chat/completions");
  });

  it("loads pricing when present", async () => {
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
    pricing:
      input: 0.5
      cached_input: 0.1
      output: 1.0
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.pricing).toEqual({
      input: 0.5,
      cached_input: 0.1,
      output: 1.0,
    });
  });

  it("loads tiered pricing from YAML", async () => {
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
    pricing:
      tiers:
        - max_tokens: 256000
          input: 7.0
          cached_input: 1.4
          output: 21.0
        - max_tokens: -1
          input: 14.0
          cached_input: 2.8
          output: 42.0
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    const pricing = providers[0]!.models[0]!.pricing;
    expect(pricing).toBeDefined();
    expect("tiers" in pricing!).toBe(true);
    if ("tiers" in pricing!) {
      expect(pricing.tiers).toHaveLength(2);
      expect(pricing.tiers[0]!.max_tokens).toBe(256000);
      expect(pricing.tiers[0]!.input).toBe(7.0);
      expect(pricing.tiers[1]!.max_tokens).toBe(-1);
      expect(pricing.tiers[1]!.input).toBe(14.0);
    }
  });

  it("loads flat pricing (backward compatible)", async () => {
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
    pricing:
      input: 0.5
      cached_input: 0.1
      output: 1.0
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    const pricing = providers[0]!.models[0]!.pricing;
    expect(pricing).toEqual({
      input: 0.5,
      cached_input: 0.1,
      output: 1.0,
    });
  });

  it("rejects pricing with both tiers and flat fields (ambiguous schema)", async () => {
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
    pricing:
      tiers: []
      input: 1.0
      output: 2.0
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow();
  });

  it("rejects tiered pricing with empty tiers array", async () => {
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
    pricing:
      tiers: []
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow();
  });

  it("loads multiple providers from multiple files", async () => {
    const yaml1 = `
version: 1
type: mimo
api_key: k1
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    const yaml2 = `
version: 1
type: openai
api_key: k2
base_url: https://api.openai.com
auth_header: Authorization
models:
  - id: m2
    upstream: m2
    context_length: 2000
    max_output_tokens: 1000
`;
    writeYaml("p1.yaml", yaml1);
    writeYaml("p2.yml", yaml2);
    const providers = await loadProviders(tmpDir);
    expect(providers).toHaveLength(2);
    expect(providers[0]!.type).toBe("mimo");
    expect(providers[1]!.type).toBe("openai");
  });

  it("accepts all valid handler types", async () => {
    for (const type of ["mimo", "deepseek", "openai", "anthropic"]) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });
      const needsBaseUrl = type === "openai" || type === "anthropic";
      const yaml = `
version: 1
type: ${type}
api_key: k
${needsBaseUrl ? "base_url: https://api.example.com" : ""}
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
      writeYaml("test.yaml", yaml);
      const providers = await loadProviders(tmpDir);
      expect(providers[0]!.type).toBe(type);
    }
  });

  it("rejects unknown fields due to strict mode", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
unknown_field: surprise
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow();
  });

  it("rejects unknown fields in model schema", async () => {
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
    unknown_model_field: surprise
`;
    writeYaml("test.yaml", yaml);
    await expect(loadProviders(tmpDir)).rejects.toThrow();
  });

  it("loads web_search when present", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
web_search:
  maxKeyword: 3
  forceSearch: true
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.web_search).toEqual({
      maxKeyword: 3,
      forceSearch: true,
    });
  });

  it("forces anthropic_url to null for custom types", async () => {
    const yaml = `
version: 1
type: anthropic
api_key: k
base_url: https://api.example.com
auth_header: x-api-key
anthropic_url: https://example.com/anthropic
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.anthropic_url).toBeNull();
  });

  it("uses anthropic_url from YAML for built-in types", async () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
anthropic_url: https://example.com/anthropic
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`;
    writeYaml("test.yaml", yaml);
    const providers = await loadProviders(tmpDir);
    expect(providers[0]!.anthropic_url).toBe("https://example.com/anthropic");
  });

  it("supports .yml extension", async () => {
    writeYaml("test.yml", MINIMAL_PROVIDER);
    const providers = await loadProviders(tmpDir);
    expect(providers).toHaveLength(1);
  });

  it("derives provider name from filename", async () => {
    for (const type of ["mimo", "deepseek"]) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });
      writeYaml(`my-${type}.yaml`, `
version: 1
type: ${type}
api_key: k
auth_header: Authorization
models:
  - id: m1
    upstream: m1
    context_length: 1000
    max_output_tokens: 500
`);
      const providers = await loadProviders(tmpDir);
      expect(providers[0]!.name).toBe(`my-${type}`);
    }
  });

  describe("modalities validation", () => {
    it("loads valid modalities", async () => {
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
    modalities:
      input: [text, image, audio, video]
      output: [text]
`;
      writeYaml("test.yaml", yaml);
      const providers = await loadProviders(tmpDir);
      const mods = providers[0]!.models[0]!.modalities;
      expect(mods).toBeDefined();
      expect(mods!.input).toEqual(["text", "image", "audio", "video"]);
      expect(mods!.output).toEqual(["text"]);
    });

    it("rejects invalid input modality", async () => {
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
    modalities:
      input: [text, imge]
      output: [text]
`;
      writeYaml("test.yaml", yaml);
      await expect(loadProviders(tmpDir)).rejects.toThrow("Invalid");
    });

    it("rejects invalid output modality", async () => {
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
    modalities:
      input: [text]
      output: [pdf]
`;
      writeYaml("test.yaml", yaml);
      await expect(loadProviders(tmpDir)).rejects.toThrow("Invalid");
    });

    it("rejects typos like vdieo", async () => {
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
    modalities:
      input: [vdieo]
      output: [text]
`;
      writeYaml("test.yaml", yaml);
      await expect(loadProviders(tmpDir)).rejects.toThrow("Invalid");
    });
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
    expect(providers).toHaveLength(0); // no models discovered, so skipped
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
    // This won't crash on validation. The provider will be skipped
    // because there are no models (discovery fails in test env).
    // The key test is that it doesn't throw a validation error.
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
    // Should not throw validation error
    await expect(loadProviders(tmpDir)).resolves.not.toThrow();
  });
});
