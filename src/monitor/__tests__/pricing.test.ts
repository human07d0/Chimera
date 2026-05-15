import { describe, it, expect, beforeEach } from "vitest";
import { calculateCost, getTier, PRICING, flatPricingMap, registerFlatPricing, registerProviderPricing } from "../pricing";

describe("getTier", () => {
  it("returns first tier when tokens <= threshold", () => {
    const tiers = PRICING["mimo-v2-pro"].tiers;
    expect(getTier(100, tiers)).toBe(tiers[0]);
    expect(getTier(256_000, tiers)).toBe(tiers[0]);
  });

  it("returns second tier when tokens > first threshold", () => {
    const tiers = PRICING["mimo-v2-pro"].tiers;
    expect(getTier(256_001, tiers)).toBe(tiers[1]);
  });

  it("returns single-tier model correctly", () => {
    const tiers = PRICING["mimo-v2-flash"].tiers;
    expect(getTier(0, tiers)).toBe(tiers[0]);
    expect(getTier(1_000_000, tiers)).toBe(tiers[0]);
  });

  it("returns tier 0 when tokens are below threshold", () => {
    const tiers = PRICING["mimo-v2-pro"].tiers;
    const tier = getTier(100_000, tiers);
    expect(tier.threshold).toBe(256_000);
  });

  it("returns tier 1 when tokens exceed threshold", () => {
    const tiers = PRICING["mimo-v2-pro"].tiers;
    const tier = getTier(300_000, tiers);
    expect(tier.threshold).toBe(Infinity);
  });

  it("returns tier at exact threshold boundary", () => {
    const tiers = PRICING["mimo-v2-pro"].tiers;
    const tier = getTier(256_000, tiers);
    expect(tier.threshold).toBe(256_000);
  });

  it("throws on empty tiers array", () => {
    expect(() => getTier(100, [])).toThrow("Empty tiers");
  });
});

describe("calculateCost", () => {
  beforeEach(() => {
    flatPricingMap.clear();
  });

  it("calculates cost for mimo-v2-flash (single tier)", () => {
    // input: 1M tokens * 0.7 = 0.7, output: 1M tokens * 2.1 = 2.1
    const cost = calculateCost("mimo-v2-flash", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(0.7 + 2.1, 6);
  });

  it("deducts cached tokens from input cost", () => {
    // 1M input, 500K cached: paid = 500K * 0.7/1M + 500K * 0.07/1M = 0.35 + 0.035
    const cost = calculateCost("mimo-v2-flash", 1_000_000, 500_000, 0);
    expect(cost).toBeCloseTo(0.35 + 0.035, 6);
  });

  it("calculates cost for mimo-v2-pro with tiered pricing", () => {
    // 100K input (tier 1): 100K * 7.0/1M = 0.7
    // 100K output (tier 1): 100K * 21.0/1M = 2.1
    const cost = calculateCost("mimo-v2-pro", 100_000, 0, 100_000);
    expect(cost).toBeCloseTo(0.7 + 2.1, 6);
  });

  it("uses higher tier for large total tokens on mimo-v2-pro", () => {
    // 300K input + 100K output = 400K total > 256K → tier 1 for both
    // input: 300K * 14.0/1M = 4.2, output: 100K * 42.0/1M = 4.2
    const cost = calculateCost("mimo-v2-pro", 300_000, 0, 100_000);
    expect(cost).toBeCloseTo(4.2 + 4.2, 6);
  });

  it("falls back to mimo-v2-flash for unknown model", () => {
    const cost = calculateCost("unknown-model", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(0.7 + 2.1, 6);
  });

  it("returns 0 for zero tokens", () => {
    expect(calculateCost("mimo-v2-flash", 0, 0, 0)).toBe(0);
  });

  it("handles all cached tokens (no paid input cost)", () => {
    // 1M input all cached: 1M * 0.07/1M = 0.07, output: 0
    const cost = calculateCost("mimo-v2-flash", 1_000_000, 1_000_000, 0);
    expect(cost).toBeCloseTo(0.07, 6);
  });

  it("uses single tier based on total tokens (C1)", () => {
    // 10 prompt + 300K completion = 300K total > 256K threshold
    // Should use tier 1 for BOTH input and output
    const cost = calculateCost("mimo-v2-pro", 10, 0, 300_000);

    const tier1 = PRICING["mimo-v2-pro"].tiers[1]; // threshold: Infinity
    const expectedPrompt = (10 / 1_000_000) * tier1.inputPrice;
    const expectedCompletion = (300_000 / 1_000_000) * tier1.outputPrice;
    expect(cost).toBeCloseTo(expectedPrompt + expectedCompletion, 5);
  });

  it("uses tier 0 when total tokens below threshold", () => {
    const cost = calculateCost("mimo-v2-pro", 100_000, 0, 100_000);

    const tier0 = PRICING["mimo-v2-pro"].tiers[0]; // threshold: 256_000
    const expectedPrompt = (100_000 / 1_000_000) * tier0.inputPrice;
    const expectedCompletion = (100_000 / 1_000_000) * tier0.outputPrice;
    expect(cost).toBeCloseTo(expectedPrompt + expectedCompletion);
  });

  it("accounts for cached tokens at cached price", () => {
    const cost = calculateCost("mimo-v2-pro", 100_000, 50_000, 100_000);

    const tier0 = PRICING["mimo-v2-pro"].tiers[0];
    const expectedCached = (50_000 / 1_000_000) * tier0.cachedPrice;
    const expectedPrompt = (50_000 / 1_000_000) * tier0.inputPrice;
    const expectedCompletion = (100_000 / 1_000_000) * tier0.outputPrice;
    expect(cost).toBeCloseTo(expectedCached + expectedPrompt + expectedCompletion);
  });

});

describe("registerFlatPricing", () => {
  beforeEach(() => {
    flatPricingMap.clear();
  });

  it("adds flat pricing to the map", () => {
    registerFlatPricing("flat-test-model", { input: 5, output: 10 });
    const cost = calculateCost("flat-test-model", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(5 + 10, 6);
  });

  it("supports cached_input pricing in flat pricing", () => {
    registerFlatPricing("flat-cached-model", { input: 5, cached_input: 1, output: 10 });
    const cost = calculateCost("flat-cached-model", 1_000_000, 500_000, 1_000_000);
    expect(cost).toBeCloseTo(2.5 + 0.5 + 10, 6);
  });

  it("defaults cached_input to 0 when not provided", () => {
    registerFlatPricing("flat-no-cache", { input: 5, output: 10 });
    const cost = calculateCost("flat-no-cache", 1_000_000, 500_000, 0);
    expect(cost).toBeCloseTo(2.5, 6);
  });
});

describe("calculateCost with flat pricing", () => {
  beforeEach(() => {
    flatPricingMap.clear();
    registerFlatPricing("flat-model-only", { input: 3, cached_input: 0.5, output: 9 });
  });

  it("uses flat pricing when available (not in PRICING)", () => {
    const cost = calculateCost("flat-model-only", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(3 + 9, 6);
  });

  it("prefers flat pricing over tiered pricing when both exist", () => {
    registerFlatPricing("mimo-v2-flash", { input: 1, cached_input: 0.1, output: 3 });
    const cost = calculateCost("mimo-v2-flash", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(1 + 3, 6);
  });

  it("falls back to tiered pricing when flat pricing map is empty for model", () => {
    const cost = calculateCost("mimo-v2-flash", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(0.7 + 2.1, 6);
  });
});

describe("registerProviderPricing", () => {
  beforeEach(() => {
    flatPricingMap.clear();
  });

  it("registers pricing under both virtual model ID and upstream model ID", () => {
    registerProviderPricing([
      {
        models: [
          {
            id: "virtual-model-abc",
            upstream: "upstream-model-xyz",
            pricing: { input: 2, cached_input: 0.3, output: 6 },
          },
        ],
      },
    ]);

    const costByUpstream = calculateCost("upstream-model-xyz", 1_000_000, 0, 1_000_000);
    expect(costByUpstream).toBeCloseTo(2 + 6, 6);

    const costByVirtual = calculateCost("virtual-model-abc", 1_000_000, 0, 1_000_000);
    expect(costByVirtual).toBeCloseTo(2 + 6, 6);
  });

  it("does not throw when model has no pricing", () => {
    expect(() => {
      registerProviderPricing([
        {
          models: [
            { id: "test-id", upstream: "test-upstream" },
          ],
        },
      ]);
    }).not.toThrow();
  });

  it("does not register anything when there are no models", () => {
    expect(() => {
      registerProviderPricing([]);
    }).not.toThrow();
    expect(flatPricingMap.size).toBe(0);
  });

  it("registers multiple providers with multiple models", () => {
    registerProviderPricing([
      {
        models: [
          { id: "v1", upstream: "u1", pricing: { input: 1, output: 2 } },
          { id: "v2", upstream: "u2", pricing: { input: 3, output: 4 } },
        ],
      },
      {
        models: [
          { id: "v3", upstream: "u3", pricing: { input: 5, output: 6 } },
        ],
      },
    ]);

    expect(calculateCost("u1", 1_000_000, 0, 1_000_000)).toBeCloseTo(1 + 2, 6);
    expect(calculateCost("v2", 1_000_000, 0, 1_000_000)).toBeCloseTo(3 + 4, 6);
    expect(calculateCost("u3", 1_000_000, 0, 1_000_000)).toBeCloseTo(5 + 6, 6);

    expect(flatPricingMap.size).toBe(6);
  });
});