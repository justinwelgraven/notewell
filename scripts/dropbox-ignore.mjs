// Tells Dropbox not to sync folders that each computer must create for itself:
//   node_modules  - contains Windows- or Mac-specific programs (hundreds of MB)
//   dist          - build output
// Runs automatically before `npm install`. Safe to run any time; does nothing without Dropbox.
// https://help.dropbox.com/sync/ignored-files
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.CI) process.exit(0); // build servers have no Dropbox

// .git too: Dropbox syncing a Git repository between computers can corrupt it.
// The repository lives on the Windows PC; GitHub is the shared copy.
for (const name of ["node_modules", "dist", ".git"]) {
  const dir = join(root, name);
  if (name === ".git" && !existsSync(dir)) continue;
  mkdirSync(dir, { recursive: true });
  try {
    if (process.platform === "win32") {
      // NTFS alternate data stream that Dropbox reads.
      writeFileSync(`${dir}:com.dropbox.ignored`, "1");
    } else if (process.platform === "darwin") {
      execFileSync("xattr", ["-w", "com.dropbox.ignored", "1", dir]);
    } else {
      execFileSync("attr", ["-s", "com.dropbox.ignored", "-V", "1", dir]);
    }
  } catch (e) {
    console.warn(`Could not mark ${name} as ignored by Dropbox: ${e.message}`);
  }
}
