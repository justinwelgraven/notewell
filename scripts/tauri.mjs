// Runs the Tauri CLI with the right settings for building on this computer.
//  - Rust's build output goes OUTSIDE the project folder: the project lives in Dropbox and the
//    build folder is several GB and machine-specific (also avoids Windows' 260-character path limit).
//  - Update packages are signed with the private key notewell.key (user profile or project folder; never committed).
// On GitHub's build servers (CI) both are handled by the workflow instead.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const env = { ...process.env };

if (!process.env.CI) {
  env.CARGO_TARGET_DIR ||=
    process.platform === "win32"
      ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "notewell-build")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Caches", "notewell-build")
        : join(homedir(), ".cache", "notewell-build");

  // The key may be in your user profile (~/.tauri) or in the project folder in Dropbox
  // (handy on the Mac). It's never committed: *.key is in .gitignore.
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const keyFile = [join(homedir(), ".tauri", "notewell.key"), join(projectRoot, "notewell.key")].find((f) => existsSync(f));
  if (!env.TAURI_SIGNING_PRIVATE_KEY && keyFile) {
    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, "utf8").trim();
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
  }
}

const args = process.argv.slice(2);
// Without the signing key (e.g. building on a new Mac), still build — just without update packages.
if (args[0] === "build" && !env.TAURI_SIGNING_PRIVATE_KEY) {
  args.push("--config", JSON.stringify(JSON.stringify({ bundle: { createUpdaterArtifacts: false } })));
}

const quoted = args.map((a) => (/^[\w./:=@-]+$/.test(a) || a.startsWith('"') ? a : JSON.stringify(a)));
const child = spawn(["tauri", ...quoted].join(" "), { stdio: "inherit", shell: true, env });
child.on("exit", (code) => process.exit(code ?? 1));
