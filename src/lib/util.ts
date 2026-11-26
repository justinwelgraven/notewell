import type { JSONContent } from "@tiptap/core";
import type { AppData } from "../types";

/** Note-list thumbnails of pictures in notes look like "nwimg:<id>" (see lib/images.ts). */
const IMAGE_THUMB_PREFIX = "nwimg:";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Evernote-style relative dates: "Just now", "5 min ago", "Yesterday", "Nov 3", "Nov 3, 2025". */
export function relativeDate(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const d = new Date(ts);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ts >= startOfToday) return `${Math.floor(min / 60)} hr ago`;
  if (ts >= startOfToday - 86400000) return "Yesterday";
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function fullDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Plain text of a note body (one line per block), for list previews and search. */
export function docText(node: JSONContent | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const inner = (node.content ?? []).map(docText);
  const isBlockContainer = (node.content ?? []).some((c) => c.type !== "text" && c.type !== "hardBreak");
  return inner.join(isBlockContainer ? "\n" : "");
}

/** Finds the first preview image or video thumbnail in a note, for the note list. */
export function findThumb(node: JSONContent | null | undefined): string | null {
  if (!node) return null;
  if (node.type === "linkPreview" && node.attrs?.image) return node.attrs.image;
  if (node.type === "embed" && node.attrs?.thumb) return node.attrs.thumb;
  if (node.type === "noteImage" && node.attrs?.id) return IMAGE_THUMB_PREFIX + node.attrs.id;
  for (const c of node.content ?? []) {
    const t = findThumb(c);
    if (t) return t;
  }
  return null;
}

/**
 * Data for a brand-new install: one empty notebook, no notes.
 * The notebook is a placeholder: if Dropbox already has notebooks (another device), the first sync
 * replaces it with those, so new devices never add another "First Notebook".
 */
export function seedData(): AppData {
  const id = uid();
  return {
    version: 1,
    defaultNotebookId: id,
    notebooks: [{ id, name: "First Notebook", createdAt: Date.now() }],
    notes: [],
    placeholderNotebook: id,
  };
}