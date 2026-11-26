import type { AppData } from "../types";
import { idbGet, idbSet } from "./idb";

/** True when running inside the Tauri desktop shell (false in a plain browser during development). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const LS_KEY = "notewell-data";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

export async function loadData(): Promise<AppData | null> {
  let raw: string | null | undefined;
  if (isTauri) raw = await invoke<string | null>("load_data");
  else {
    // Web: IndexedDB (older test builds used localStorage; move that over once).
    raw = await idbGet<string>(LS_KEY);
    if (!raw && localStorage.getItem(LS_KEY)) {
      raw = localStorage.getItem(LS_KEY);
      await idbSet(LS_KEY, raw);
      localStorage.removeItem(LS_KEY);
    }
    // Ask the browser not to clear our data when space runs low.
    navigator.storage?.persist?.().catch(() => {});
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AppData;
    return parsed && Array.isArray(parsed.notes) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveData(data: AppData): Promise<void> {
  const raw = JSON.stringify(data);
  if (isTauri) await invoke("save_data", { data: raw });
  else await idbSet(LS_KEY, raw);
}

export interface FetchedPage {
  final_url: string;
  html: string;
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  if (!isTauri) throw new Error("Link previews need the desktop app");
  return invoke<FetchedPage>("fetch_page", { url });
}

/** Opens a URL in the system's default browser. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

/** Opens (or focuses) the small always-on-top quick note window. Also bound to Ctrl+Alt+N system-wide. */
export async function openQuickNote(): Promise<void> {
  if (isTauri) await invoke("open_quick_note");
}

/** True in the quick-note window (or with ?quick in a browser, for development). */
export function isQuickWindow(): boolean {
  if (new URLSearchParams(location.search).has("quick")) return true;
  const meta = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__;
  return meta?.metadata?.currentWindow?.label === "quick";
}

/**
 * Runs `beforeClose` (e.g. a final save) when this window's close button is pressed,
 * then lets the native side close the window.
 */
export async function onWindowClose(beforeClose: () => Promise<void> | void): Promise<() => void> {
  if (!isTauri) {
    const handler = () => void beforeClose();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow().listen("app-close-requested", async () => {
    try {
      await beforeClose();
    } finally {
      await invoke("finish_close");
    }
  });
}

/** Fully quits the app (the X button only hides it to the tray). Saves first. */
export async function quitApp(): Promise<void> {
  if (isTauri) await invoke("quit");
}

/** Closes this window right away (after the caller has saved). */
export async function closeThisWindow(): Promise<void> {
  if (isTauri) await invoke("finish_close");
  else window.close();
}

/** Saves one last time before the main window closes. */
export function onAppClose(getData: () => AppData | null): Promise<() => void> {
  return onWindowClose(async () => {
    const d = getData();
    if (d) await saveData(d);
  });
}
