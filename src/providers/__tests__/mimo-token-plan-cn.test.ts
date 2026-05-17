import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

const CONFIG_PATH = path.resolve(
  __dirname,
  "../../builtin_provider_config/mimo-token-plan-cn.yaml",
);

interface ModelEntry {
  id: string;
  modalities?: {
    input: string[];
    output: string[];
  };
}

interface ParsedConfig {
  models: ModelEntry[];
}

function loadConfig(): ParsedConfig {
  const content = fs.readFileSync(CONFIG_PATH, "utf-8");
  return parseYaml(content) as ParsedConfig;
}

describe("mimo-token-plan-cn.yaml modalities", () => {
  const config = loadConfig();

  const modelIds = config.models.map((m) => m.id);

  it("has exactly 15 models", () => {
    expect(config.models).toHaveLength(15);
  });

  const expectedModalities: Record<string, { input: string[]; output: string[] }> = {
    "mimo-v2-flash": {
      input: ["text"],
      output: ["text"],
    },
    "mimo-v2-pro": {
      input: ["text", "image"],
      output: ["text"],
    },
    "mimo-v2-omni": {
      input: ["text", "image", "video", "audio"],
      output: ["text"],
    },
    "mimo-v2.5": {
      input: ["text", "image", "video", "audio"],
      output: ["text"],
    },
    "mimo-v2.5-pro": {
      input: ["text", "image"],
      output: ["text"],
    },
    "mimo-v2-flash-thinking": {
      input: ["text"],
      output: ["text"],
    },
    "mimo-v2-pro-thinking": {
      input: ["text", "image"],
      output: ["text"],
    },
    "mimo-v2-omni-thinking": {
      input: ["text", "image", "video", "audio"],
      output: ["text"],
    },
    "mimo-v2.5-thinking": {
      input: ["text", "image", "video", "audio"],
      output: ["text"],
    },
    "mimo-v2.5-pro-thinking": {
      input: ["text", "image"],
      output: ["text"],
    },
    "mimo-v2-flash-thinking-search": {
      input: ["text"],
      output: ["text"],
    },
    "mimo-v2-pro-thinking-search": {
      input: ["text", "image"],
      output: ["text"],
    },
    "mimo-v2-omni-thinking-search": {
      input: ["text", "image", "video", "audio"],
      output: ["text"],
    },
    "mimo-v2.5-thinking-search": {
      input: ["text", "image", "video", "audio"],
      output: ["text"],
    },
    "mimo-v2.5-pro-thinking-search": {
      input: ["text", "image"],
      output: ["text"],
    },
  };

  for (const model of config.models) {
    it(`model "${model.id}" has correct modalities`, () => {
      const expected = expectedModalities[model.id];
      expect(expected).toBeDefined();
      expect(model.modalities).toEqual(expected);
    });
  }
});
