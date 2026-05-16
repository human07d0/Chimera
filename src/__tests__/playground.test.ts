import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

const htmlPath = path.resolve(__dirname, "../playground/index.html");

function loadScript(): string {
  const html = fs.readFileSync(htmlPath, "utf-8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("No <script> found in playground HTML");
  return match[1];
}

function createTestContext(configOverrides: Record<string, unknown> = {}) {
  const scriptContent = loadScript();

  const elements: Record<string, { value: string; textContent: string; innerHTML: string; options: Record<string, string>[] }> = {};

  const sandbox: vm.Context = vm.createContext({
    document: {
      getElementById: (id: string) => {
        if (!elements[id]) {
          elements[id] = { value: "", textContent: "", innerHTML: "", options: [] };
        }
        return {
          get value() { return elements[id].value; },
          set value(v: string) { elements[id].value = v; },
          get textContent() { return elements[id].textContent; },
          set textContent(v: string) { elements[id].textContent = v; },
          get innerHTML() { return elements[id].innerHTML; },
          set innerHTML(v: string) { elements[id].innerHTML = v; if (v === "") elements[id].options = []; },
          get options() { return elements[id].options; },
          appendChild: (child: Record<string, unknown>) => {
            if (child && typeof child.value === "string" && typeof child.textContent === "string") {
              elements[id].options.push({ value: child.value, textContent: child.textContent });
            }
          },
          children: [] as unknown[],
        };
      },
      createElement: (_tag: string) => ({
        value: "" as string,
        textContent: "" as string,
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        appendChild: () => {},
        disabled: false,
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
        children: [] as unknown[],
      }),
      querySelectorAll: () => [] as unknown[],
    },
    window: { PLAYGROUND_CONFIG: configOverrides },
    console: { log: () => {}, error: () => {}, warn: () => {} },
    performance: { now: () => 0 },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve("") }),
    TextDecoder: class {
      decode() {
        return "";
      }
    },
    AbortController: class {
      signal = {};
      abort() {}
    },
    confirm: () => false,
    setTimeout: () => 0,
  });

  vm.runInContext(scriptContent, sandbox);

  // Functions become properties of the sandbox context
  const ctx = sandbox as unknown as Record<string, unknown>;
  return {
    getSelectedEndpointInfo: ctx.getSelectedEndpointInfo as () => {
      protocol: string;
      prefix: string;
    },
    onEndpointChange: ctx.onEndpointChange as () => void,
    getSuffix: ctx.getSuffix as (protocol: string) => string,
    elements,
  };
}

describe("Playground - endpoint prefix format (new)", () => {
  describe("getSuffix", () => {
    it("returns OpenAI suffix for 'openai' protocol", () => {
      const { getSuffix } = createTestContext();
      expect(getSuffix("openai")).toBe("/v1/chat/completions");
    });

    it("returns Anthropic suffix for 'anthropic' protocol", () => {
      const { getSuffix } = createTestContext();
      expect(getSuffix("anthropic")).toBe("/anthropic/v1/messages");
    });
  });

  describe("getSelectedEndpointInfo", () => {
    it("returns protocol and prefix from proto:prefix value", () => {
      const { getSelectedEndpointInfo, elements } = createTestContext({
        endpoints: ["", "/token-plan"],
      });

      elements.endpoint.value = "openai:/token-plan";
      const result = getSelectedEndpointInfo();

      expect(result.protocol).toBe("openai");
      expect(result.prefix).toBe("/token-plan");
    });

    it("handles empty prefix correctly", () => {
      const { getSelectedEndpointInfo, elements } = createTestContext({
        endpoints: [""],
      });

      elements.endpoint.value = "openai:";
      const result = getSelectedEndpointInfo();

      expect(result.protocol).toBe("openai");
      expect(result.prefix).toBe("");
    });

    it("handles anthropic protocol", () => {
      const { getSelectedEndpointInfo, elements } = createTestContext({
        endpoints: ["/ch1", ""],
      });

      elements.endpoint.value = "anthropic:/ch1";
      const result = getSelectedEndpointInfo();

      expect(result.protocol).toBe("anthropic");
      expect(result.prefix).toBe("/ch1");
    });

    it("handles anthropic with empty prefix", () => {
      const { getSelectedEndpointInfo, elements } = createTestContext({
        endpoints: [""],
      });

      elements.endpoint.value = "anthropic:";
      const result = getSelectedEndpointInfo();

      expect(result.protocol).toBe("anthropic");
      expect(result.prefix).toBe("");
    });

    it("does not contain old endpointLabel or endpointPrefix properties", () => {
      const { getSelectedEndpointInfo, elements } = createTestContext({
        endpoints: [""],
      });

      elements.endpoint.value = "openai:";
      const result = getSelectedEndpointInfo();

      expect((result as Record<string, unknown>).endpointLabel).toBeUndefined();
      expect((result as Record<string, unknown>).endpointPrefix).toBeUndefined();
    });

    it("does not include fullPath in return value", () => {
      const { getSelectedEndpointInfo, elements } = createTestContext({
        endpoints: [""],
      });

      elements.endpoint.value = "openai:";
      const result = getSelectedEndpointInfo();

      expect((result as Record<string, unknown>).fullPath).toBeUndefined();
    });
  });

  describe("onEndpointChange", () => {
    it("populates model select from CONFIG.endpointModels for the selected prefix", () => {
      const { onEndpointChange, elements } = createTestContext({
        endpoints: ["", "/token-plan"],
        endpointModels: {
          "": ["model-a", "model-b"],
          "/token-plan": ["token-model-1", "token-model-2"],
        },
      });

      elements.endpoint.value = "openai:/token-plan";
      onEndpointChange();

      const modelSelect = elements.model;
      expect(modelSelect.options.length).toBe(2);
      expect(modelSelect.options[0].value).toBe("token-model-1");
      expect(modelSelect.options[0].textContent).toBe("token-model-1");
      expect(modelSelect.options[1].value).toBe("token-model-2");
      expect(modelSelect.options[1].textContent).toBe("token-model-2");
    });
  });

  describe("endpoint dropdown initialization", () => {
    it("creates options with proto:prefix values and full path display text", () => {
      const { elements } = createTestContext({
        endpoints: ["", "/token-plan", "/ch1"],
      });

      const endpointSelect = elements.endpoint;
      expect(endpointSelect).toBeDefined();
      expect(endpointSelect.options.length).toBe(6); // 3 endpoints × 2 protocols

      const values = endpointSelect.options.map((o: Record<string, string>) => o.value).sort();
      expect(values).toEqual([
        "anthropic:",
        "anthropic:/ch1",
        "anthropic:/token-plan",
        "openai:",
        "openai:/ch1",
        "openai:/token-plan",
      ]);

      // First option should display the full path
      const openaiEmpty = endpointSelect.options.find(
        (o: Record<string, string>) => o.value === "openai:",
      );
      expect(openaiEmpty).toBeDefined();
      expect(openaiEmpty!.textContent).toBe("/v1/chat/completions");

      const anthropicTokenPlan = endpointSelect.options.find(
        (o: Record<string, string>) => o.value === "anthropic:/token-plan",
      );
      expect(anthropicTokenPlan).toBeDefined();
      expect(anthropicTokenPlan!.textContent).toBe("/token-plan/anthropic/v1/messages");
    });
  });
});
