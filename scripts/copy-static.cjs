const fs = require("fs");
const path = require("path");

const rootDir = process.cwd();
const tasks = [
  {
    source: path.join(rootDir, "public"),
    target: path.join(rootDir, "dist", "public"),
  },
];

for (const { source, target } of tasks) {
  if (!fs.existsSync(source)) {
    console.log(`[copy-static] Skipped missing directory: ${path.relative(rootDir, source)}`);
    continue;
  }

  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });

  console.log(
    `[copy-static] Copied ${path.relative(rootDir, source)} -> ${path.relative(rootDir, target)}`
  );
}
