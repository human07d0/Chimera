import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/proxy/**/*.test.ts",
      "src/debug/**/*.test.ts",
      "src/monitor/**/*.test.ts",
      "src/utils/**/*.test.ts",
      "src/__tests__/**/*.test.ts",
      "src/ops/**/*.test.ts",
      "src/providers/**/*.test.ts",
      "src/routes/**/*.test.ts",
    ],
  },
});
