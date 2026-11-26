/** True on macOS (and iOS/iPadOS). */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * Shows a shortcut the way each platform writes it:
 * kbd("Ctrl+Alt+N") → "Ctrl+Alt+N" on Windows, "⌥⌘N" on Mac.
 */
export function kbd(combo: string): string {
  if (!isMac) return combo;
  const parts = combo.split("+");
  const key = parts.pop()!;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const keyLabel = key === "Enter" ? "↩" : key;
  return `${mods.has("alt") ? "⌥" : ""}${mods.has("shift") ? "⇧" : ""}${mods.has("ctrl") ? "⌘" : ""}${keyLabel}`;
}

/** The shortcut that opens a quick note from anywhere (registered natively). */
export const QUICK_NOTE_KEYS = kbd("Ctrl+Alt+N");
