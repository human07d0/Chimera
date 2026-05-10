export interface PriceTier {
  threshold: number;
  inputPrice: number;
  cachedPrice: number;
  outputPrice: number;
}

export interface ModelPricing {
  tiers: PriceTier[];
}

export const PRICING: Record<string, ModelPricing> = {
  "mimo-v2-flash": {
    tiers: [
      { threshold: Infinity, inputPrice: 0.7, cachedPrice: 0.07, outputPrice: 2.1 },
    ],
  },
  "mimo-v2-pro": {
    tiers: [
      { threshold: 256_000, inputPrice: 7.0, cachedPrice: 1.4, outputPrice: 21.0 },
      { threshold: Infinity, inputPrice: 14.0, cachedPrice: 2.8, outputPrice: 42.0 },
    ],
  },
  "mimo-v2-omni": {
    tiers: [
      { threshold: 256_000, inputPrice: 2.8, cachedPrice: 0.56, outputPrice: 14.0 },
      { threshold: Infinity, inputPrice: 5.6, cachedPrice: 1.12, outputPrice: 28.0 },
    ],
  },
  "mimo-v2.5": {
    tiers: [
      { threshold: 256_000, inputPrice: 2.8, cachedPrice: 0.56, outputPrice: 14.0 },
      { threshold: Infinity, inputPrice: 5.6, cachedPrice: 1.12, outputPrice: 28.0 },
    ],
  },
  "mimo-v2.5-pro": {
    tiers: [
      { threshold: 256_000, inputPrice: 7.0, cachedPrice: 1.4, outputPrice: 21.0 },
      { threshold: Infinity, inputPrice: 14.0, cachedPrice: 2.8, outputPrice: 42.0 },
    ],
  },
};

export function getTier(tokens: number, tiers: PriceTier[]): PriceTier {
  if (tiers.length === 0) {
    throw new Error("Empty tiers");
  }
  for (const tier of tiers) {
    if (tokens <= tier.threshold) return tier;
  }
  return tiers[tiers.length - 1];
}

export function calculateCost(
  modelId: string,
  promptTokens: number,
  cachedPromptTokens: number,
  completionTokens: number,
): number {
  const pricing = PRICING[modelId] || PRICING["mimo-v2-flash"];
  const tier = getTier(promptTokens + completionTokens, pricing.tiers);

  const paidPromptTokens = Math.max(promptTokens - cachedPromptTokens, 0);
  const cachedCost = (cachedPromptTokens / 1_000_000) * tier.cachedPrice;
  const promptCost = (paidPromptTokens / 1_000_000) * tier.inputPrice;
  const completionCost = (completionTokens / 1_000_000) * tier.outputPrice;
  return cachedCost + promptCost + completionCost;
}