import { describe, it, expect, beforeEach } from "vitest";
import { calculateCost, getTier, pricingMap, registerPricing, registerProviderPricing } from "../pricing";

describe("getTier", () => {
  const twoTier = [
    { max_tokens: 256_000, input: 7.0, cached_input: 1.4, output: 21.0 },
    { max_tokens: -1, input: 14.0, cached_input: 2.8, output: 42.0 },
  ];
  const singleTier = [
    { max_tokens: -1, input: 0.7, cached_input: 0.07, output: 2.1 },
  ];

  it("returns first tier when tokens <= max_tokens", () => {
    expect(getTier(100, twoTier)).toBe(twoTier[0]);
    expect(getTier(256_000, twoTier)).toBe(twoTier[0]);
  });

  it("returns second tier when tokens > first max_tokens", () => {
    expect(getTier(256_001, twoTier)).toBe(twoTier[1]);
  });

  it("returns single-tier model correctly", () => {
    expect(getTier(0, singleTier)).toBe(singleTier[0]);
    expect(getTier(1_000_000, singleTier)).toBe(singleTier[0]);
  });

  it("returns tier 0 when tokens are below max_tokens", () => {
    const tier = getTier(100_000, twoTier);
    expect(tier.max_tokens).toBe(256_000);
  });

  it("returns tier 1 when tokens exceed max_tokens", () => {
    const tier = getTier(300_000, twoTier);
    expect(tier.max_tokens).toBe(-1);
  });

  it("returns tier at exact max_tokens boundary", () => {
    const tier = getTier(256_000, twoTier);
    expect(tier.max_tokens).toBe(256_000);
  });

  it("throws on empty tiers array", () => {
    expect(() => getTier(100, [])).toThrow("Empty tiers");
  });

  it("handles tiers in reverse order (-1 first)", () => {
    const reversed = [
      { max_tokens: -1, input: 14.0, cached_input: 2.8, output: 42.0 },
      { max_tokens: 256_000, input: 7.0, cached_input: 1.4, output: 21.0 },
    ];
    expect(getTier(100, reversed).max_tokens).toBe(256_000);
    expect(getTier(300_000, reversed).max_tokens).toBe(-1);
  });

  it("handles tiers already sorted", () => {
    const sorted = [
      { max_tokens: 100_000, input: 1.0, cached_input: 0.1, output: 3.0 },
      { max_tokens: 500_000, input: 2.0, cached_input: 0.2, output: 6.0 },
      { max_tokens: -1, input: 4.0, cached_input: 0.4, output: 12.0 },
    ];
    expect(getTier(50_000, sorted).max_tokens).toBe(100_000);
    expect(getTier(200_000, sorted).max_tokens).toBe(500_000);
    expect(getTier(1_000_000, sorted).max_tokens).toBe(-1);
  });

  it("handles arbitrary unsorted order", () => {
    const arbitrary = [
      { max_tokens: 500_000, input: 2.0, cached_input: 0.2, output: 6.0 },
      { max_tokens: 100_000, input: 1.0, cached_input: 0.1, output: 3.0 },
      { max_tokens: -1, input: 4.0, cached_input: 0.4, output: 12.0 },
    ];
    expect(getTier(50_000, arbitrary).max_tokens).toBe(100_000);
    expect(getTier(200_000, arbitrary).max_tokens).toBe(500_000);
    expect(getTier(1_000_000, arbitrary).max_tokens).toBe(-1);
  });

  it("does not mutate the input tiers array", () => {
    const original = [
      { max_tokens: -1, input: 14.0, cached_input: 2.8, output: 42.0 },
      { max_tokens: 256_000, input: 7.0, cached_input: 1.4, output: 21.0 },
    ];
    const frozen = [...original];
    getTier(100, original);
    expect(original).toEqual(frozen);
  });
});

describe("calculateCost", () => {
  beforeEach(() => {
    pricingMap.clear();
    registerPricing("mimo-v2-flash", {
      tiers: [{ max_tokens: -1, input: 0.7, cached_input: 0.07, output: 2.1 }],
    });
    registerPricing("mimo-v2-pro", {
      tiers: [
        { max_tokens: 256_000, input: 7.0, cached_input: 1.4, output: 21.0 },
        { max_tokens: -1, input: 14.0, cached_input: 2.8, output: 42.0 },
      ],
    });
  });

  it("calculates cost for mimo-v2-flash (single tier)", () => {
    const cost = calculateCost("mimo-v2-flash", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(0.7 + 2.1, 6);
  });

  it("deducts cached tokens from input cost", () => {
    const cost = calculateCost("mimo-v2-flash", 1_000_000, 500_000, 0);
    expect(cost).toBeCloseTo(0.35 + 0.035, 6);
  });

  it("calculates cost for mimo-v2-pro with tiered pricing", () => {
    const cost = calculateCost("mimo-v2-pro", 100_000, 0, 100_000);
    expect(cost).toBeCloseTo(0.7 + 2.1, 6);
  });

  it("uses higher tier for large total tokens on mimo-v2-pro", () => {
    const cost = calculateCost("mimo-v2-pro", 300_000, 0, 100_000);
    expect(cost).toBeCloseTo(4.2 + 4.2, 6);
  });

  it("returns 0 for unknown model", () => {
    const cost = calculateCost("unknown-model", 1_000_000, 0, 1_000_000);
    expect(cost).toBe(0);
  });

  it("returns 0 for zero tokens", () => {
    expect(calculateCost("mimo-v2-flash", 0, 0, 0)).toBe(0);
  });

  it("handles all cached tokens (no paid input cost)", () => {
    const cost = calculateCost("mimo-v2-flash", 1_000_000, 1_000_000, 0);
    expect(cost).toBeCloseTo(0.07, 6);
  });

  it("uses single tier based on total tokens (C1)", () => {
    const cost = calculateCost("mimo-v2-pro", 10, 0, 300_000);

    const expectedPrompt = (10 / 1_000_000) * 14.0;
    const expectedCompletion = (300_000 / 1_000_000) * 42.0;
    expect(cost).toBeCloseTo(expectedPrompt + expectedCompletion, 5);
  });

  it("uses tier 0 when total tokens below threshold", () => {
    const cost = calculateCost("mimo-v2-pro", 100_000, 0, 100_000);

    const expectedPrompt = (100_000 / 1_000_000) * 7.0;
    const expectedCompletion = (100_000 / 1_000_000) * 21.0;
    expect(cost).toBeCloseTo(expectedPrompt + expectedCompletion);
  });

  it("accounts for cached tokens at cached price", () => {
    const cost = calculateCost("mimo-v2-pro", 100_000, 50_000, 100_000);

    const expectedCached = (50_000 / 1_000_000) * 1.4;
    const expectedPrompt = (50_000 / 1_000_000) * 7.0;
    const expectedCompletion = (100_000 / 1_000_000) * 21.0;
    expect(cost).toBeCloseTo(expectedCached + expectedPrompt + expectedCompletion);
  });

});

describe("registerPricing", () => {
  beforeEach(() => {
    pricingMap.clear();
  });

  it("adds flat pricing to the map", () => {
    registerPricing("flat-test-model", { input: 5, output: 10 });
    const cost = calculateCost("flat-test-model", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(5 + 10, 6);
  });

  it("supports cached_input pricing in flat pricing", () => {
    registerPricing("flat-cached-model", { input: 5, cached_input: 1, output: 10 });
    const cost = calculateCost("flat-cached-model", 1_000_000, 500_000, 1_000_000);
    expect(cost).toBeCloseTo(2.5 + 0.5 + 10, 6);
  });

  it("defaults cached_input to 0 when not provided", () => {
    registerPricing("flat-no-cache", { input: 5, output: 10 });
    const cost = calculateCost("flat-no-cache", 1_000_000, 500_000, 0);
    expect(cost).toBeCloseTo(2.5, 6);
  });
});

describe("calculateCost with flat pricing", () => {
  beforeEach(() => {
    pricingMap.clear();
    registerPricing("flat-model-only", { input: 3, cached_input: 0.5, output: 9 });
  });

  it("uses flat pricing when available (not tiered)", () => {
    const cost = calculateCost("flat-model-only", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(3 + 9, 6);
  });

  it("prefers flat pricing over tiered pricing when both exist", () => {
    registerPricing("mimo-v2-flash", { input: 1, cached_input: 0.1, output: 3 });
    const cost = calculateCost("mimo-v2-flash", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(1 + 3, 6);
  });

  it("uses tiered pricing when registered as tiered", () => {
    registerPricing("mimo-v2-flash", {
      tiers: [{ max_tokens: -1, input: 0.7, cached_input: 0.07, output: 2.1 }],
    });
    const cost = calculateCost("mimo-v2-flash", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(0.7 + 2.1, 6);
  });
});

describe("registerProviderPricing", () => {
  beforeEach(() => {
    pricingMap.clear();
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
    expect(pricingMap.size).toBe(0);
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

    expect(pricingMap.size).toBe(6);
  });

  it("registers tiered pricing from providers", () => {
    registerProviderPricing([
      {
        models: [
          {
            id: "tiered-v",
            upstream: "tiered-u",
            pricing: {
              tiers: [
                { max_tokens: 100_000, input: 2.0, output: 6.0 },
                { max_tokens: -1, input: 4.0, output: 12.0 },
              ],
            },
          },
        ],
      },
    ]);

    const costLow = calculateCost("tiered-v", 50_000, 0, 50_000);
    expect(costLow).toBeCloseTo(0.1 + 0.3, 6);

    const costHigh = calculateCost("tiered-u", 200_000, 0, 200_000);
    expect(costHigh).toBeCloseTo(0.8 + 2.4, 6);
  });
});