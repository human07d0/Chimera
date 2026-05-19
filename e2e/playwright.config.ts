import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",

  use: {
    baseURL: "http://localhost:3000",
  },

  webServer: {
    command: "node dist/index.js",
    cwd: "..",
    port: 3000,
    timeout: 15000,
    reuseExistingServer: true,
    // .env is loaded by dotenv/config in src/config.ts

  },

  projects: [
    {
      name: "api",
      testMatch: "api.spec.ts",
    },
    {
      name: "ops-ui",
      testMatch: "ops-ui.spec.ts",
      use: {
        browserName: "chromium",
        headless: true,
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
});
