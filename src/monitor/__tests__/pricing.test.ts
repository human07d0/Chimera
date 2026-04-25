import { describe, it, expect } from "vitest";
import { calculateCost, getTier, PRICING } from "../pricing";

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
});

describe("calculateCost", () => {
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

  it("uses higher tier for large input on mimo-v2-pro", () => {
    // 300K input (tier 2): 300K * 14.0/1M = 4.2
    // 100K output (tier 1): 100K * 21.0/1M = 2.1
    const cost = calculateCost("mimo-v2-pro", 300_000, 0, 100_000);
    expect(cost).toBeCloseTo(4.2 + 2.1, 6);
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
});