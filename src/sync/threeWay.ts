/**
 * Three-way merge of a note edited on two devices since their last sync.
 *
 * `base` is the version both devices last had (downloaded from Dropbox by its revision). Each part of
 * the note that only one device changed takes that device's change; parts both devices changed the
 * same way are fine too. Only when both changed the very same part differently is there a real
 * conflict: then this returns null and sync keeps a "(conflicted copy)" as before.
 *
 * The body is merged block by block (paragraphs, headers, pictures, …), and inside lists, checklists
 * and quotes item by item, so e.g. deleting a picture on one device and ticking a checklist item or
 * typing in another paragraph on the other device merge cleanly.
 */
import type { JSONContent } from "@tiptap/core";
import type { Note } from "../types";
import { docText, findThumb } from "../lib/util";

type J = JSONContent;
const key = (n: unknown) => JSON.stringify(n ?? null);
const same = (a: unknown, b: unknown) => key(a) === key(b);

/** Nodes whose children are blocks/items (merged child by child). Paragraph-like text is merged whole. */
const CONTAINERS = new Set(["doc", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "blockquote"]);

const CONFLICT = Symbol("conflict");
type Merged<T> = T | typeof CONFLICT;

/** One value: whichever side changed it wins; both changed differently = conflict. */
function pick<T>(base: T, a: T, b: T): Merged<T> {
  if (same(a, base)) return b;
  if (same(b, base) || same(a, b)) return a;
  return CONFLICT;
}

/** Longest common subsequence of two key lists → for each index in `x`, its match in `y` (or -1). */
function lcs(x: string[], y: string[]): number[] {
  const n = x.length;
  const m = y.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const match = new Array<number>(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (x[i] === y[j]) {
      match[i] = j;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return match;
}

/** diff3 over lists of nodes. */
function mergeList(base: J[], a: J[], b: J[]): Merged<J[]> {
  if (same(a, base)) return b;
  if (same(b, base) || same(a, b)) return a;
  if (base.length * Math.max(a.length, b.length) > 4_000_000) return CONFLICT; // absurdly large: don't try
  const kb = base.map(key);
  const ma = lcs(kb, a.map(key));
  const mb = lcs(kb, b.map(key));
  const out: J[] = [];
  let i = 0;
  let ia = 0;
  let ib = 0;
  while (true) {
    // Next base item that's unchanged on both sides: everything before it is one "chunk".
    let j = i;
    while (j < base.length && (ma[j] < 0 || mb[j] < 0)) j++;
    const endA = j < base.length ? ma[j] : a.length;
    const endB = j < base.length ? mb[j] : b.length;
    const cb = base.slice(i, j);
    const ca = a.slice(ia, endA);
    const cbb = b.slice(ib, endB);
    if (cb.length || ca.length || cbb.length) {
      if (same(ca, cb)) out.push(...cbb);
      else if (same(cbb, cb) || same(ca, cbb)) out.push(...ca);
      else if (cb.length === ca.length && ca.length === cbb.length) {
        // The same items changed on both sides (e.g. different checklist items ticked): merge them one by
        // one, inside each item.
        for (let k = 0; k < cb.length; k++) {
          const m = mergeNode(cb[k], ca[k], cbb[k]);
          if (m === CONFLICT) return CONFLICT;
          out.push(m);
        }
      } else return CONFLICT;
    }
    if (j >= base.length) break;
    out.push(base[j]);
    i = j + 1;
    ia = ma[j] + 1;
    ib = mb[j] + 1;
  }
  return out;
}

function mergeNode(base: J, a: J, b: J): Merged<J> {
  const quick = pick(base, a, b);
  if (quick !== CONFLICT) return quick;
  if (!(a.type === base.type && b.type === base.type && CONTAINERS.has(base.type ?? ""))) return CONFLICT;
  const attrs: Record<string, unknown> = {};
  const names = new Set([...Object.keys(base.attrs ?? {}), ...Object.keys(a.attrs ?? {}), ...Object.keys(b.attrs ?? {})]);
  for (const k of names) {
    const v = pick(base.attrs?.[k], a.attrs?.[k], b.attrs?.[k]);
    if (v === CONFLICT) return CONFLICT;
    if (v !== undefined) attrs[k] = v;
  }
  const content = mergeList(base.content ?? [], a.content ?? [], b.content ?? []);
  if (content === CONFLICT) return CONFLICT;
  return { ...base, ...(names.size ? { attrs } : {}), content };
}

/** Tags: additions from both sides kept, removals from either side applied. */
function mergeTags(base: string[], a: string[], b: string[]): string[] {
  const removed = new Set([...base.filter((t) => !a.includes(t)), ...base.filter((t) => !b.includes(t))]);
  return [...new Set([...a, ...b])].filter((t) => !removed.has(t));
}

/** The merged note, or null when both devices changed the same part differently. */
export function mergeNoteEdits(base: Note, local: Note, remote: Note): Note | null {
  const title = pick(base.title, local.title, remote.title);
  const notebookId = pick(base.notebookId, local.notebookId, remote.notebookId);
  const starred = pick(base.starred, local.starred, remote.starred);
  const pinned = pick(!!base.pinned, !!local.pinned, !!remote.pinned);
  const trashedAt = pick(base.trashedAt, local.trashedAt, remote.trashedAt);
  const content = base.content && local.content && remote.content
    ? mergeNode(base.content, local.content, remote.content)
    : pick(base.content, local.content, remote.content);
  if ([title, notebookId, starred, pinned, trashedAt, content].includes(CONFLICT)) return null;
  const body = content as J | null;
  return {
    ...local,
    title: title as string,
    notebookId: notebookId as string,
    starred: starred as boolean,
    pinned: pinned as boolean,
    trashedAt: trashedAt as number | null,
    content: body,
    text: docText(body),
    thumb: findThumb(body),
    tags: mergeTags(base.tags, local.tags, remote.tags),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt) + 1,
  };
}
