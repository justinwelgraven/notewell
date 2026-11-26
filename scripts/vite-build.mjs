// Runs `vite build`, retrying when Windows briefly locks the output folder
// (Dropbox or antivirus scanning freshly written files → EPERM / EBUSY).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vite = join(root, "node_modules", "vite", "bin", "vite.js");
const args = ["build", ...process.argv.slice(2)];

/**
 * Gives every build's service worker a unique cache name. A changed sw.js is how browsers notice a new
 * version: the web app then shows "A new version of Notewell is ready → Reload" (src/lib/webUpdate.ts).
 */
function stampServiceWorker() {
  const i = args.indexOf("--outDir");
  const sw = join(root, i >= 0 ? args[i + 1] : "dist", "sw.js");
  if (!existsSync(sw)) return;
  const build = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  writeFileSync(sw, readFileSync(sw, "utf8").replace(/notewell-app-[\w-]+/, `notewell-app-${build}`));
}

for (let attempt = 1; ; attempt++) {
  const r = spawnSync(process.execPath, [vite, ...args], { cwd: root, encoding: "utf8" });
  process.stdout.write(r.stdout ?? "");
  const locked = /EPERM|EBUSY|resource busy|Permission denied/i.test((r.stderr ?? "") + (r.stdout ?? ""));
  if (r.status === 0 || !locked || attempt >= 5) {
    process.stderr.write(r.stderr ?? "");
    if (r.status === 0) stampServiceWorker();
    process.exit(r.status ?? 1);
  }
  console.log(`Output folder is busy (Dropbox/antivirus) — retrying in ${attempt * 2}s…`);
  await new Promise((res) => setTimeout(res, attempt * 2000));
}
