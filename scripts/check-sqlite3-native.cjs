#!/usr/bin/env node

const monitorStorage = (process.env.MONITOR_STORAGE || "memory").toLowerCase();

if (monitorStorage !== "sqlite") {
  process.exit(0);
}

try {
  const sqlite3 = require("sqlite3");
  const bindingPath =
    sqlite3?.Database?.prototype?._events?.profile?.toString?.() ||
    sqlite3?.Database?.name ||
    "loaded";

  console.log(
    `[prestart] sqlite3 native binding check passed (MONITOR_STORAGE=sqlite).`
  );
  if (process.env.LOG_LEVEL === "debug") {
    console.log(`[prestart] sqlite3 runtime hint: ${bindingPath}`);
  }
  process.exit(0);
} catch (error) {
  const e = error;
  console.error(
    "[prestart] sqlite3 native binding check failed while MONITOR_STORAGE=sqlite."
  );
  console.error("[prestart] Error:", e && e.message ? e.message : String(error));
  console.error("[prestart] Suggested fix:");
  console.error("  1) Ensure pnpm-workspace.yaml allows sqlite3 build");
  console.error("     allowBuilds:");
  console.error("       sqlite3: true");
  console.error("  2) Rebuild native module:");
  console.error("     pnpm rebuild sqlite3");
  console.error("  3) If still failing, reinstall dependencies:");
  console.error("     rmdir /s /q node_modules && pnpm install");
  process.exit(1);
}
