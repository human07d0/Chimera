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

// Frontend files that should be copied into dist/ops (without deleting the whole folder)
const frontendSource = path.join(rootDir, "src", "ops", "frontend");
const frontendTarget = path.join(rootDir, "dist", "ops");

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

function copyDirContents(source, target) {
  fs.mkdirSync(target, { recursive: true });

  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDirContents(sourcePath, targetPath);
    } else {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

// Copy main tasks (public, watcher-child.js)
for (const task of tasks) {
  const { source, target, optional } = task;

  if (!fs.existsSync(source)) {
    if (optional) {
  console.log(
        `[copy-static] Skipped (optional): ${path.relative(rootDir, source)}`
  );
    } else {
      console.log(
        `[copy-static] Skipped missing: ${path.relative(rootDir, source)}`
      );
}
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

// Copy frontend contents into dist/ops (without deleting existing files)
if (fs.existsSync(frontendSource)) {
  copyDirContents(frontendSource, frontendTarget);
  console.log(
    `[copy-static] Copied ${path.relative(rootDir, frontendSource)} -> ${path.relative(rootDir, frontendTarget)}`
  );
} else {
  console.log(
    `[copy-static] Skipped missing: ${path.relative(rootDir, frontendSource)}`
  );
}

