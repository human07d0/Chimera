const { execSync } = require("child_process");

const steps = [
  { name: "Typecheck", cmd: "pnpm run typecheck" },
  { name: "Test", cmd: "pnpm test" },
  { name: "Build", cmd: "pnpm run build" },
];

let failed = false;

for (const step of steps) {
  console.log(`\n[verify] ${step.name}...`);
  try {
    execSync(step.cmd, { stdio: "inherit", cwd: process.cwd() });
    console.log(`[verify] ${step.name} passed`);
  } catch {
    console.error(`[verify] ${step.name} FAILED`);
    failed = true;
    break;
  }
}

if (failed) {
  console.error("\n[verify] Aborted — fix errors above before proceeding.\n");
  process.exit(1);
}

console.log("\n[verify] All steps passed.\n");
