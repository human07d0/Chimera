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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loader-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
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
  it("returns empty string for empty input", () => {
    expect(normalizeEndpoint("")).toBe("");
  });

  it("strips leading slashes", () => {
    expect(normalizeEndpoint("/v1/chat")).toBe("/v1/chat");
  });

  it("strips trailing slashes", () => {
    expect(normalizeEndpoint("v1/chat/")).toBe("/v1/chat");
  });

  it("strips both leading and trailing slashes", () => {
    expect(normalizeEndpoint("/v1/chat/")).toBe("/v1/chat");
  });

  it("collapses bare slash to empty", () => {
    expect(normalizeEndpoint("/")).toBe("");
  });

  it("collapses multiple slashes to empty", () => {
    expect(normalizeEndpoint("///")).toBe("");
  });

  it("handles path without leading slash", () => {
    expect(normalizeEndpoint("v1/chat")).toBe("/v1/chat");
  });
});

describe("resolveEnvVars", () => {
  it("resolves single variable", () => {
    process.env["TEST_LOADER_VAR"] = "hello";
    expect(resolveEnvVars("${TEST_LOADER_VAR}")).toBe("hello");
    delete process.env["TEST_LOADER_VAR"];
  });

  it("resolves multiple variables in one string", () => {
    process.env["A"] = "foo";
    process.env["B"] = "bar";
    expect(resolveEnvVars("${A}-${B}")).toBe("foo-bar");
    delete process.env["A"];
    delete process.env["B"];
  });

  it("preserves text around variables", () => {
    process.env["KEY"] = "secret";
    expect(resolveEnvVars("Bearer ${KEY}")).toBe("Bearer secret");
    delete process.env["KEY"];
  });

  it("returns empty string for missing variable", () => {
    delete process.env["MISSING"];
    expect(resolveEnvVars("${MISSING}")).toBe("");
  });

  it("resolves empty string env var to empty string", () => {
    process.env["EMPTY"] = "";
    expect(resolveEnvVars("${EMPTY}")).toBe("");
    delete process.env["EMPTY"];
  });
});

describe("loadProviders", () => {
  it("loads a valid minimal provider", () => {
    writeYaml("test.yaml", MINIMAL_PROVIDER);
    const providers = loadProviders(tmpDir);
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("test");
    expect(providers[0]!.type).toBe("mimo");
    expect(providers[0]!.api_key).toBe("test-key");
    expect(providers[0]!.auth_header).toBe("Authorization");
    expect(providers[0]!.auth_prefix).toBe("Bearer ");
    expect(providers[0]!.models).toHaveLength(1);
    expect(providers[0]!.models[0]!.id).toBe("model-a");
  });

  it("applies default values for optional fields", () => {
    writeYaml("test.yaml", MINIMAL_PROVIDER);
    const providers = loadProviders(tmpDir);
    const p = providers[0]!;
    expect(p.timeout).toBe(120000);
    expect(p.endpoint).toBe("");
    expect(p.capabilities).toEqual({});
    expect(p.web_search).toBeNull();
    expect(p.base_url).toBe("https://api.xiaomimimo.com");
    expect(p.anthropic_url).toBe("https://api.xiaomimimo.com/anthropic");
  });

  it("generates description from id when absent", () => {
    writeYaml("test.yaml", MINIMAL_PROVIDER);
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.description).toBe("model-a");
  });

  it("uses provided description when present", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.description).toBe("My Model");
  });

  it("sets created to load time when absent", () => {
    const before = Math.floor(Date.now() / 1000);
    writeYaml("test.yaml", MINIMAL_PROVIDER);
    const providers = loadProviders(tmpDir);
    const after = Math.floor(Date.now() / 1000);
    expect(providers[0]!.models[0]!.created).toBeGreaterThanOrEqual(before);
    expect(providers[0]!.models[0]!.created).toBeLessThanOrEqual(after);
  });

  it("uses provided created when present", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.created).toBe(1700000000);
  });

  it("resolves ${VAR} references in api_key", () => {
    process.env["MY_API_KEY"] = "resolved-key";
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
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.api_key).toBe("resolved-key");
    delete process.env["MY_API_KEY"];
  });

  it("resolves ${VAR} in nested model fields", () => {
    process.env["MODEL_ID"] = "resolved-id";
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
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.id).toBe("resolved-id");
    delete process.env["MODEL_ID"];
  });

  it("loads provider with empty api_key when env var is missing", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers).toHaveLength(1);
    expect(providers[0]!.api_key).toBe("");
  });

  it("loads provider with empty api_key when env var is empty string", () => {
    process.env["EMPTY_KEY"] = "";
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
    const providers = loadProviders(tmpDir);
    expect(providers).toHaveLength(1);
    expect(providers[0]!.api_key).toBe("");
    delete process.env["EMPTY_KEY"];
  });

  it("skips provider not in enabledProviderNames set", () => {
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
    const providers = loadProviders(tmpDir, new Set(["other"]));
    expect(providers).toHaveLength(0);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("not in ENABLED_PROVIDERS"),
    );
  });

  it("loads provider in enabledProviderNames set", () => {
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
    const providers = loadProviders(tmpDir, new Set(["test"]));
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("test");
  });

  it("loads all providers when enabledProviderNames is null", () => {
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
    const providers = loadProviders(tmpDir, null);
    expect(providers).toHaveLength(1);
  });

  it("throws on malformed YAML", () => {
    writeYaml("bad.yaml", ":\n  - :\n  invalid: [yaml");
    expect(() => loadProviders(tmpDir)).toThrow("Failed to parse YAML file");
  });

  it("throws on unknown type", () => {
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
    expect(() => loadProviders(tmpDir)).toThrow();
  });

  it("throws on version != 1", () => {
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
    expect(() => loadProviders(tmpDir)).toThrow();
  });

  it("throws on default.max_tokens", () => {
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
    expect(() => loadProviders(tmpDir)).toThrow("default.max_tokens is not allowed");
  });

  it("allows provider-specific default keys like thinking", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.default).toEqual({
      thinking: true,
      response_format: { type: "json_object" },
    });
  });

  it("detects duplicate model id within same endpoint", () => {
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
    expect(() => loadProviders(tmpDir)).toThrow("Duplicate model id 'same-id'");
  });

  it("allows same model id at different endpoints", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers).toHaveLength(2);
    expect(providers[0]!.models[0]!.id).toBe("shared-id");
    expect(providers[1]!.models[0]!.id).toBe("shared-id");
  });

  it("performs capabilities shallow merge", () => {
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
    const providers = loadProviders(tmpDir);
    const caps = providers[0]!.models[0]!.capabilities!;
    expect(caps.thinking).toBe(true);
    expect(caps.json).toBe(true);
    expect(caps.search).toBe(false);
    expect(caps.tools).toBe(true);
  });

  it("preserves provider capabilities when model has none", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.capabilities).toEqual({
      thinking: true,
      json: true,
    });
  });

  it("logs warning and skips provider with empty models", () => {
    const yaml = `
version: 1
type: mimo
api_key: k
auth_header: Authorization
models: []
`;
    writeYaml("test.yaml", yaml);
    const providers = loadProviders(tmpDir);
    expect(providers).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no models"),
    );
  });

  it("returns empty array when config dir does not exist", () => {
    const providers = loadProviders("/nonexistent/path");
    expect(providers).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });

  it("returns empty array when no yaml files exist", () => {
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "no yaml here");
    const providers = loadProviders(tmpDir);
    expect(providers).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("No YAML files"),
    );
  });

  it("uses filename stem as provider name when name is absent", () => {
    writeYaml("my-provider.yaml", MINIMAL_PROVIDER);
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.name).toBe("my-provider");
  });

  it("rejects YAML with name field due to strict mode", () => {
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
    expect(() => loadProviders(tmpDir)).toThrow(/unrecognized_keys|name/);
  });

  it("normalizes endpoint", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.endpoint).toBe("/v1/chat/completions");
  });

  it("loads pricing when present", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.models[0]!.pricing).toEqual({
      input: 0.5,
      cached_input: 0.1,
      output: 1.0,
    });
  });

  it("loads multiple providers from multiple files", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers).toHaveLength(2);
    expect(providers[0]!.type).toBe("mimo");
    expect(providers[1]!.type).toBe("openai");
  });

  it("accepts all valid handler types", () => {
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
      const providers = loadProviders(tmpDir);
      expect(providers[0]!.type).toBe(type);
    }
  });

  it("rejects unknown fields due to strict mode", () => {
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
    expect(() => loadProviders(tmpDir)).toThrow();
  });

  it("rejects unknown fields in model schema", () => {
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
    expect(() => loadProviders(tmpDir)).toThrow();
  });

  it("loads web_search when present", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.web_search).toEqual({
      maxKeyword: 3,
      forceSearch: true,
    });
  });

  it("forces anthropic_url to null for custom types", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.anthropic_url).toBeNull();
  });

  it("uses anthropic_url from YAML for built-in types", () => {
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
    const providers = loadProviders(tmpDir);
    expect(providers[0]!.anthropic_url).toBe("https://example.com/anthropic");
  });

  it("supports .yml extension", () => {
    writeYaml("test.yml", MINIMAL_PROVIDER);
    const providers = loadProviders(tmpDir);
    expect(providers).toHaveLength(1);
  });

  it("derives provider name from filename", () => {
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
      const providers = loadProviders(tmpDir);
      expect(providers[0]!.name).toBe(`my-${type}`);
    }
  });
});
