import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/proxy/**/*.test.ts", "src/debug/**/*.test.ts"],
    exclude: ["src/ops/**"],
  },
});
