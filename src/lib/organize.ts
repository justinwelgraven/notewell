/**
 * Tag management (rename / delete a tag everywhere) and notebook stacks. Pure functions on AppData.
 *
 * Tags can also live in the note text as "#tag" (see editor/Hashtags.ts). Renaming or deleting a tag
 * rewrites those too — otherwise the old tag would come straight back the next time the note is edited.
 */
import type { JSONContent } from "@tiptap/core";
import type { AppData, Note } from "../types";
import { docText } from "./util";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Replaces "#old" in text with "#new" (or with plain "old" when `to` is null). */
function rewriteHashtags(node: JSONContent | null, from: string, to: string | null): JSONContent | null {
  if (!node) return node;
  if (node.type === "codeBlock") return node;
  if (node.type === "text" && node.text) {
    if (node.marks?.some((m) => m.type === "code" || m.type === "link")) return node;
    const re = new RegExp(`(^|[\\s(\\[{"'“])#${escape(from)}(?![\\p{L}\\p{N}_\\-/])`, "giu");
    const text = node.text.replace(re, (_m, pre: string, offset: number, all: string) => {
      const original = all.slice(offset + pre.length + 1, offset + pre.length + 1 + from.length);
      return to === null ? pre + original : `${pre}#${to}`;
    });
    return text === node.text ? node : { ...node, text };
  }
  if (!node.content) return node;
  let changed = false;
  const content = node.content.map((c) => {
    const r = rewriteHashtags(c, from, to)!;
    if (r !== c) changed = true;
    return r;
  });
  return changed ? { ...node, content } : node;
}

function retag(d: AppData, tag: string, to: string | null): AppData {
  const now = Date.now();
  return {
    ...d,
    notes: d.notes.map((n): Note => {
      const has = n.tags.some((t) => same(t, tag));
      const content = rewriteHashtags(n.content, tag, to);
      if (!has && content === n.content) return n;
      let tags = n.tags.filter((t) => !same(t, tag));
      if (to !== null && has && !tags.some((t) => same(t, to))) tags = [...tags, to];
      return { ...n, tags, content, text: content === n.content ? n.text : docText(content), updatedAt: now };
    }),
  };
}

/** Renames a tag on every note (merges into an existing tag with that name). */
export const renameTag = (d: AppData, from: string, to: string) => retag(d, from, to.replace(/^#/, "").trim());

/** Removes a tag from every note; "#tag" in the text becomes plain "tag". */
export const deleteTag = (d: AppData, tag: string) => retag(d, tag, null);

// ---- Notebook stacks ----

const touchNotebooks = (d: AppData, notebooks: AppData["notebooks"]): AppData => ({ ...d, notebooks, notebooksUpdatedAt: Date.now() });

/** Puts a notebook in a stack (created if new), or takes it out with stack = null. */
export function setNotebookStack(d: AppData, id: string, stack: string | null): AppData {
  const name = stack?.trim() || undefined;
  return touchNotebooks(d, d.notebooks.map((nb) => (nb.id === id ? { ...nb, stack: name } : nb)));
}

export function renameStack(d: AppData, from: string, to: string): AppData {
  return touchNotebooks(d, d.notebooks.map((nb) => (nb.stack === from ? { ...nb, stack: to.trim() } : nb)));
}

/** Removes the stack; its notebooks stay, just no longer grouped. */
export function removeStack(d: AppData, stack: string): AppData {
  return touchNotebooks(d, d.notebooks.map((nb) => (nb.stack === stack ? { ...nb, stack: undefined } : nb)));
}

export function stacksOf(d: AppData): string[] {
  return [...new Set(d.notebooks.map((nb) => nb.stack).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b));
}
