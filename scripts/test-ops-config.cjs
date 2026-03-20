#!/usr/bin/env node

/**
 * Automated test script for Ops config key consistency
 * Verifies that /ops/config and /ops/config/schema return matching flat keys
 */

const http = require("http");
const { spawn } = require("child_process");

// Configuration
const PROXY_PORT = 19093;
const OPS_PASSWORD = "ops-test-password";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

function startProxy(port) {
  const child = spawn(process.execPath, ["dist/index.js"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      LOG_LEVEL: "error",
      MIMO_API_KEY: "dummy-key",
      PROXY_API_KEY: "proxy-test-key",
      OPS_PASSWORD: OPS_PASSWORD,
      MONITOR_STORAGE: "memory",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (d) => process.stdout.write(`[proxy:${port}] ${d}`));
  child.stderr.on("data", (d) =>
    process.stderr.write(`[proxy:${port}:err] ${d}`)
  );

  return child;
}

async function stopProxy(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 5000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function opsFetch(path, init = {}) {
  const url = `http://127.0.0.1:${PROXY_PORT}/ops${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${OPS_PASSWORD}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await res.json();
  return { status: res.status, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Expected flat keys that should appear in both schema and config.
 * Any key in schema should have a corresponding value in config (except sensitive).
 */
const EXPECTED_WRITABLE_KEYS = [
  "logLevel",
  "webSearchMaxKeyword",
  "webSearchForceSearch",
  "webSearchLimit",
  "webSearchCountry",
  "webSearchRegion",
  "webSearchCity",
  "monitorFlushIntervalMs",
  "monitorRetentionDays",
];

async function runTests() {
  console.log("=".repeat(60));
  console.log("Ops Config Key Consistency Test Suite");
  console.log("=".repeat(60));
  console.log();

  let proxy;
  let testsPassed = 0;
  let testsFailed = 0;
  const failedTests = [];
  let exitCode = 0;

  try {
    // Start proxy
    console.log(`Starting proxy on port ${PROXY_PORT}...`);
    proxy = startProxy(PROXY_PORT);
    await waitForHttp(`http://127.0.0.1:${PROXY_PORT}/health`, 15000);
    console.log("Proxy started.\n");

    // ========== Test 1: Ops info ==========
    console.log("[Test 1] Ops info endpoint");
    try {
      const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/ops/info`);
      const body = await res.json();
      assert(body.success === true, "Ops info should succeed");
      assert(body.data.enabled === true, "Ops should be enabled");
      console.log("  ✓ Ops info returns correct data\n");
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ Ops info: ${err.message}\n`);
      testsFailed++;
      failedTests.push({ test: "ops-info", error: err.message });
    }

    // ========== Test 2: Config schema completeness ==========
    console.log("[Test 2] Config schema completeness");
    try {
      const res = await opsFetch("/config/schema");
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.success === true, "Schema request should succeed");

      const schemaKeys = Object.keys(res.body.data);
      console.log(`  Schema keys found: ${schemaKeys.join(", ")}`);

      for (const expectedKey of EXPECTED_WRITABLE_KEYS) {
        assert(
          schemaKeys.includes(expectedKey),
          `Missing key '${expectedKey}' in schema`
        );
        console.log(`  ✓ schema contains '${expectedKey}'`);
      }
      console.log("  ✓ All expected keys present in schema\n");
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ Schema completeness: ${err.message}\n`);
      testsFailed++;
      failedTests.push({ test: "schema-completeness", error: err.message });
    }

    // ========== Test 3: Config response structure (flat keys) ==========
    console.log("[Test 3] Config response uses flat keys");
    try {
      const res = await opsFetch("/config");
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.success === true, "Config request should succeed");

      const config = res.body.data;

      // Sensitive keys are nested, we check they exist
      assert(
        config.sensitive && typeof config.sensitive === "object",
        "Config should contain 'sensitive' object"
      );
      console.log("  ✓ Config contains 'sensitive' object");

      // Writable keys should be flat (not nested under webSearch/monitor)
      for (const expectedKey of EXPECTED_WRITABLE_KEYS) {
        assert(
          expectedKey in config,
          `Missing flat key '${expectedKey}' in config`
        );
        const value = config[expectedKey];
        console.log(`  ✓ config.${expectedKey} = ${JSON.stringify(value)}`);
      }

      // Verify webSearch keys are NOT nested
      assert(
        !config.webSearch || typeof config.webSearch !== "object",
        "Config should NOT have nested 'webSearch' object (should be flat)"
      );
      assert(
        !config.monitor || typeof config.monitor !== "object",
        "Config should NOT have nested 'monitor' object (should be flat)"
      );
      console.log(
        "  ✓ Config uses flat structure (no nested webSearch/monitor)\n"
      );
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ Config flat keys: ${err.message}\n`);
      testsFailed++;
      failedTests.push({ test: "config-flat-keys", error: err.message });
    }

    // ========== Test 4: Schema key types ==========
    console.log("[Test 4] Schema key types are correct");
    try {
      const res = await opsFetch("/config/schema");
      const schema = res.body.data;

      // webSearchMaxKeyword should be number
      assert(
        schema.webSearchMaxKeyword.type === "number",
        `webSearchMaxKeyword should be type 'number', got '${schema.webSearchMaxKeyword.type}'`
      );
      assert(
        schema.webSearchMaxKeyword.min === 1,
        "webSearchMaxKeyword should have min=1"
      );
      console.log("  ✓ webSearchMaxKeyword: type=number, min=1");

      // webSearchForceSearch should be boolean
      assert(
        schema.webSearchForceSearch.type === "boolean",
        `webSearchForceSearch should be type 'boolean', got '${schema.webSearchForceSearch.type}'`
      );
      console.log("  ✓ webSearchForceSearch: type=boolean");

      // webSearchLimit should be number
      assert(
        schema.webSearchLimit.type === "number",
        `webSearchLimit should be type 'number', got '${schema.webSearchLimit.type}'`
      );
      console.log("  ✓ webSearchLimit: type=number");

      // logLevel should be string with enum
      assert(
        schema.logLevel.type === "string",
        `logLevel should be type 'string'`
      );
      assert(
        Array.isArray(schema.logLevel.enum) &&
          schema.logLevel.enum.includes("debug"),
        "logLevel should have enum including 'debug'"
      );
      console.log("  ✓ logLevel: type=string with enum\n");
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ Schema types: ${err.message}\n`);
      testsFailed++;
      failedTests.push({ test: "schema-types", error: err.message });
    }

    // ========== Test 5: Config update with webSearchMaxKeyword ==========
    console.log("[Test 5] Config update accepts webSearchMaxKeyword");
    try {
      const res = await opsFetch("/config", {
        method: "POST",
        body: JSON.stringify({ webSearchMaxKeyword: 5 }),
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.success === true, "Update should succeed");
      assert(
        res.body.data.webSearchMaxKeyword === 5,
        `webSearchMaxKeyword should be 5, got ${res.body.data.webSearchMaxKeyword}`
      );
      console.log("  ✓ webSearchMaxKeyword updated successfully\n");
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ Config update: ${err.message}\n`);
      testsFailed++;
      failedTests.push({ test: "config-update", error: err.message });
    }

    // ========== Test 6: Config schema and config keys match ==========
    console.log("[Test 6] Schema keys and config keys match");
    try {
      const [schemaRes, configRes] = await Promise.all([
        opsFetch("/config/schema"),
        opsFetch("/config"),
      ]);

      const schemaKeys = new Set(Object.keys(schemaRes.body.data));
      const configKeys = new Set(Object.keys(configRes.body.data));

      // All schema keys should exist in config (except sensitive which is only in config)
      for (const key of schemaKeys) {
        assert(
          configKeys.has(key),
          `Schema key '${key}' not found in config`
        );
      }
      console.log(
        `  ✓ All ${schemaKeys.size} schema keys found in config`
      );

      // Verify webSearchMaxKeyword exists in both
      assert(
        schemaKeys.has("webSearchMaxKeyword") &&
          configKeys.has("webSearchMaxKeyword"),
        "webSearchMaxKeyword should be in both schema and config"
      );
      console.log(
        "  ✓ webSearchMaxKeyword present in both schema and config\n"
      );
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ Key match: ${err.message}\n`);
      testsFailed++;
      failedTests.push({ test: "key-match", error: err.message });
    }

    // Summary
    console.log("=".repeat(60));
    console.log("TEST SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total:  ${testsPassed + testsFailed}`);
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);

    if (failedTests.length > 0) {
      console.log("\nFailed:");
      failedTests.forEach(({ test, error }) => {
        console.log(`  - ${test}: ${error}`);
      });
    }

    console.log("=".repeat(60));

    if (testsFailed > 0) {
      console.log("\n❌ Some tests failed!");
      exitCode = 1;
    } else {
      console.log("\n✅ All tests passed!");
      exitCode = 0;
    }
  } finally {
    if (proxy) await stopProxy(proxy);
  }

  return exitCode;
}

process.on("uncaughtException", (err) => {
  console.error("Uncaught:", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});

runTests()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });