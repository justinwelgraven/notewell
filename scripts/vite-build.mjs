// Runs `vite build`, retrying when Windows briefly locks the output folder
// (Dropbox or antivirus scanning freshly written files → EPERM / EBUSY).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vite = join(root, "node_modules", "vite", "bin", "vite.js");
const args = ["build", ...process.argv.slice(2)];

for (let attempt = 1; ; attempt++) {
  const r = spawnSync(process.execPath, [vite, ...args], { cwd: root, encoding: "utf8" });
  process.stdout.write(r.stdout ?? "");
  const locked = /EPERM|EBUSY|resource busy|Permission denied/i.test((r.stderr ?? "") + (r.stdout ?? ""));
  if (r.status === 0 || !locked || attempt >= 5) {
    process.stderr.write(r.stderr ?? "");
    process.exit(r.status ?? 1);
  }
  console.log(`Output folder is busy (Dropbox/antivirus) — retrying in ${attempt * 2}s…`);
  await new Promise((res) => setTimeout(res, attempt * 2000));
}
