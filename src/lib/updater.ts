/**
 * Automatic updates for the desktop app. New versions are published as GitHub releases
 * by .github/workflows/build.yml; the app checks at startup and every few hours.
 * Updates are signed: the app only installs ones made with the private key (see README).
 */
import { isTauri } from "./storage";

export interface AvailableUpdate {
  version: string;
  /** Downloads, installs and restarts. Call after saving. */
  install: () => Promise<void>;
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      install: async () => {
        await update.downloadAndInstall();
        // Windows closes the app itself to run the installer; on Mac we restart into the new version.
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch (e) {
    // No internet, or no release published yet: try again later.
    console.info("Update check skipped:", e);
    return null;
  }
}
