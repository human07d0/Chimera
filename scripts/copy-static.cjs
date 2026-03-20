const fs = require("fs");
const path = require("path");

const rootDir = process.cwd();
const tasks = [
  {
    source: path.join(rootDir, "public"),
    target: path.join(rootDir, "dist", "public"),
  },
  {
    source: path.join(rootDir, "src", "ops", "watcher-child.js"),
    target: path.join(rootDir, "dist", "ops", "watcher-child.js"),
  },
];

function removePathSync(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

for (const { source, target } of tasks) {
  if (!fs.existsSync(source)) {
    console.log(`[copy-static] Skipped missing directory: ${path.relative(rootDir, source)}`);
    continue;
  }

  if (path.resolve(source) === path.resolve(target)) {
    throw new Error("[copy-static] source and target cannot be the same path");
  }

  removePathSync(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });

  console.log(
    `[copy-static] Copied ${path.relative(rootDir, source)} -> ${path.relative(rootDir, target)}`
  );
}
