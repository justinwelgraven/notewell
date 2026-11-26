import type { AppData, Note } from "../types";
import { idbBatch, idbDelete, idbGet, idbGetAll } from "./idb";

/** True when running inside the Tauri desktop shell (false in a plain browser during development). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const LS_KEY = "notewell-data";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

function parse(raw: string | null | undefined): AppData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AppData;
    return parsed && Array.isArray(parsed.notes) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Web: each note is its own IndexedDB entry ("notes" store) and the rest of the app data sits under
 * META_KEY, so a save only writes the notes that actually changed (compared by object identity:
 * unchanged notes keep the same object in React state).
 */
const META_KEY = "notewell-meta";
let savedNotes = new Map<string, Note>();

async function loadWeb(): Promise<AppData | null> {
  navigator.storage?.persist?.().catch(() => {}); // ask the browser not to clear our data when space runs low
  const meta = await idbGet<Omit<AppData, "notes">>(META_KEY);
  if (meta) {
    const notes = await idbGetAll<Note>("notes");
    savedNotes = new Map(notes.map((n) => [n.id, n]));
    return { ...meta, notes } as AppData;
  }
  // Older versions: everything in one entry (or in localStorage before that). Move it over once.
  const old = parse((await idbGet<string>(LS_KEY)) ?? localStorage.getItem(LS_KEY));
  if (old) {
    await saveWeb(old);
    await idbDelete(LS_KEY);
    localStorage.removeItem(LS_KEY);
  }
  return old;
}

async function saveWeb(data: AppData): Promise<void> {
  const ops: Parameters<typeof idbBatch>[0] = [];
  const ids = new Set<string>();
  for (const n of data.notes) {
    ids.add(n.id);
    if (savedNotes.get(n.id) !== n) ops.push({ store: "notes", key: n.id, value: n });
  }
  for (const id of savedNotes.keys()) if (!ids.has(id)) ops.push({ store: "notes", key: id, del: true });
  const { notes: _omit, ...meta } = data;
  ops.push({ store: "kv", key: META_KEY, value: meta });
  await idbBatch(ops);
  savedNotes = new Map(data.notes.map((n) => [n.id, n]));
}

export async function loadData(): Promise<AppData | null> {
  if (!isTauri) return loadWeb();
  return parse(await invoke<string | null>("load_data"));
}

export async function saveData(data: AppData): Promise<void> {
  if (isTauri) await invoke("save_data", { data: JSON.stringify(data) });
  else await saveWeb(data);
}

/** Saves a file the user asked for (export / backup). Desktop: Downloads folder, shown in Explorer/Finder.
 *  Web/iPhone: the share sheet (Save to Files, AirDrop, …) or a normal download. */
export async function saveFile(name: string, content: string, type: string): Promise<string | null> {
  if (isTauri) {
    const path = await invoke<string>("save_export", { name, contents: content });
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path).catch(() => {});
    return path;
  }
  const file = new File([content], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (matchMedia("(pointer: coarse)").matches && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return null;
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return null;
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
