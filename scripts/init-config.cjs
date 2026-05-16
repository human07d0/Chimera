const fs = require("fs");
const path = require("path");

const builtinDir = path.resolve(__dirname, "../src/builtin_provider_config");
const targetDir = process.env["CONFIG_DIR"]
  ? path.resolve(process.env["CONFIG_DIR"])
  : path.resolve(__dirname, "../config/provider");

if (!fs.existsSync(builtinDir)) {
  console.error(`Builtin config directory not found: ${builtinDir}`);
  process.exit(1);
}

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log(`Created config directory: ${targetDir}`);
}

const files = fs.readdirSync(builtinDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

let copied = 0;
let skipped = 0;

for (const file of files) {
  const src = path.join(builtinDir, file);
  const dest = path.join(targetDir, file);

  if (fs.existsSync(dest)) {
    console.log(`  skip (exists): ${file}`);
    skipped++;
  } else {
    fs.copyFileSync(src, dest);
    console.log(`  copied: ${file}`);
    copied++;
  }
}

console.log(`\nDone: ${copied} copied, ${skipped} skipped`);
