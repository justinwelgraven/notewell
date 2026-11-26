import { useSyncExternalStore } from "react";
import { isTauri } from "./storage";

export type Theme = "light" | "dark" | "system";

export interface Prefs {
  theme: Theme;
  /** Copy plain text with WhatsApp-style formatting (*bold*, _italic_, ~strike~). */
  waCopy: boolean;
  /** Desktop: empty space on each side of a note, in pixels (for readability on wide windows). */
  noteMargin: number;
}

export const NOTE_MARGIN = { min: 16, max: 360, default: 56 };
export const MARGIN_PRESETS: [string, number][] = [
  ["Narrow", 24],
  ["Normal", 56],
  ["Wide", 140],
  ["Extra wide", 260],
];

const KEY = "notewell-prefs";
const DEFAULTS: Prefs = { theme: "system", waCopy: true, noteMargin: NOTE_MARGIN.default };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

let prefs = load();
const listeners = new Set<() => void>();
const media = window.matchMedia("(prefers-color-scheme: dark)");

function notify() {
  applyTheme();
  applyNoteMargin();
  listeners.forEach((l) => l());
}

function applyNoteMargin() {
  const m = Math.min(NOTE_MARGIN.max, Math.max(NOTE_MARGIN.min, Number(prefs.noteMargin) || NOTE_MARGIN.default));
  document.documentElement.style.setProperty("--note-margin", `${m}px`);
}

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  localStorage.setItem(KEY, JSON.stringify(prefs));
  notify();
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getPrefs,
  );
}

export function isDark(): boolean {
  return prefs.theme === "dark" || (prefs.theme === "system" && media.matches);
}

/** Sets the page theme and matches the native window title bar to it. */
let lastNativeTheme: string | null = null;
export function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const native = `${prefs.theme}:${dark}`;
  if (isTauri && native !== lastNativeTheme) {
    lastNativeTheme = native;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(prefs.theme === "system" ? null : dark ? "dark" : "light"))
      .catch(() => {});
  }
}

// Keep every window (main + quick note) in sync.
window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    prefs = load();
    notify();
  }
});
media.addEventListener("change", notify);
applyTheme();
applyNoteMargin();
