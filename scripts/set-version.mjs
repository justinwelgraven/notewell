// Sets the app version everywhere it's stored (used by the GitHub build: 0.1.<build number>).
// Usage: node scripts/set-version.mjs 0.1.42
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: node scripts/set-version.mjs <major.minor.patch>");
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const edit = (file, fn) => writeFileSync(join(root, file), fn(readFileSync(join(root, file), "utf8")));

edit("src-tauri/tauri.conf.json", (t) => t.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`));
edit("package.json", (t) => t.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`));
edit("src-tauri/Cargo.toml", (t) => t.replace(/^version = "[^"]+"/m, `version = "${version}"`));
console.log(`Version set to ${version}`);
