import { useSyncExternalStore } from "react";
import { isTauri } from "./storage";

export type Theme = "light" | "dark" | "system";

export interface Prefs {
  theme: Theme;
  /** Copy plain text with WhatsApp-style formatting (*bold*, _italic_, ~strike~). */
  waCopy: boolean;
}

const KEY = "notewell-prefs";
const DEFAULTS: Prefs = { theme: "system", waCopy: true };

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
  listeners.forEach((l) => l());
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
export function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  if (isTauri) {
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
