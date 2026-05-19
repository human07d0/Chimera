/**
 * E2E Ops UI browser verification tests.
 *
 * Verifies:
 *  - Login page renders correctly
 *  - Login with valid password succeeds
 *  - Dashboard renders with status/config/control panels
 *  - Logout clears session
 *  - Invalid password shows error
 */
import { test, expect } from "@playwright/test";

const OPS_PASSWORD = "opspasswd";

// ─── Login page ─────────────────────────────────────────────────────

test.describe("Ops UI Login", () => {
  test("shows login form when Ops is enabled", async ({ page }) => {
    await page.goto("/ops");

    // Wait for app to initialize (the loading screen should disappear)
    await page.waitForSelector("#login-form", { timeout: 10000 });

    // Login form elements should be visible
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("button[type='submit']")).toBeVisible();
    await expect(page.locator("button[type='submit']")).toHaveText("Login");
  });

  test("shows error for invalid password", async ({ page }) => {
    await page.goto("/ops");
    await page.waitForSelector("#login-form", { timeout: 10000 });

    await page.fill("#password", "wrong-password");
    await page.click("button[type='submit']");

    // Error message should appear
    await expect(page.locator("#login-error")).toBeVisible({ timeout: 5000 });
    const errorText = await page.locator("#login-error").textContent();
    // Ops UI renders error messages in Chinese
    expect(errorText).toContain("Invalid ops password");
  });

  test("login succeeds with correct password and redirects to dashboard", async ({
    page,
  }) => {
    await page.goto("/ops");
    await page.waitForSelector("#login-form", { timeout: 10000 });

    await page.fill("#password", OPS_PASSWORD);
    await page.click("button[type='submit']");

    // Dashboard should render: status panel, config panel, control panel
    await expect(page.locator("#status-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#config-panel")).toBeVisible();
    await expect(page.locator("#control-panel")).toBeVisible();

    // Header buttons should be present
    await expect(page.locator("#btn-refresh")).toBeVisible();
    await expect(page.locator("#btn-logout")).toBeVisible();
  });
});

// ─── Dashboard ─────────────────────────────────────────────────────

test.describe("Ops UI Dashboard", () => {
  // Helper: login before each test
  test.beforeEach(async ({ page }) => {
    await page.goto("/ops");
    await page.waitForSelector("#login-form", { timeout: 10000 });
    await page.fill("#password", OPS_PASSWORD);
    await page.click("button[type='submit']");
    await expect(page.locator("#status-panel")).toBeVisible({ timeout: 10000 });
  });

  test("status panel shows uptime and memory info", async ({ page }) => {
    // Wait for status data to load (the panel gets populated by JS)
    await page.waitForTimeout(2000);

    const statusText = await page.locator("#status-panel").textContent();

    // Ops UI renders labels in Chinese: 运行时间=Uptime, 进程=PID, Memory=unchanged
    expect(statusText).toContain("运行时间");
    expect(statusText).toContain("Memory");
    expect(statusText).toContain("进程");
  });

  test("config panel loads and shows current settings", async ({ page }) => {
    await page.waitForTimeout(2000);

    const configText = await page.locator("#config-panel").textContent();
    // Ops UI renders config panel labels in Chinese
    expect(configText).toContain("日志级别");
    expect(configText).toContain("Save Config");
  });

  test("control panel shows shutdown and restart buttons", async ({ page }) => {
    await page.waitForTimeout(2000);

    const controlText = await page.locator("#control-panel").textContent();
    expect(controlText).toContain("Shutdown");
    expect(controlText).toContain("Restart");
  });

  test("refresh button triggers data reload", async ({ page }) => {
    await page.waitForTimeout(2000);

    // Click refresh
    await page.click("#btn-refresh");

    // Should not error - just verify the UI stays intact
    await expect(page.locator("#status-panel")).toBeVisible();
    await expect(page.locator("#config-panel")).toBeVisible();
  });

  test("logout clears session and returns to login", async ({ page }) => {
    await page.waitForTimeout(1000);

    // Click logout
    await page.click("#btn-logout");

    // Should redirect back to login
    await expect(page.locator("#login-form")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#password")).toBeVisible();
  });
});
