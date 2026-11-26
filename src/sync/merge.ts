/**
 * Pure merge rules for Dropbox sync. No I/O here, so it can be tested on its own.
 *
 * Layout in Dropbox (App folder, /Apps/Notewell):
 *   /notes/<noteId>.json   one file per note
 *   /notebooks.json        notebook list + deleted notebooks
 *
 * A note is "changed locally" when its updatedAt is newer than the updatedAt recorded at the
 * last upload/download (meta.notes[id].at). If a note changed both here and elsewhere,
 * the newer edit stays as the note and the other version is kept as a "(conflicted copy)" note,
 * so nothing is ever lost.
 */
import type { AppData, Note, Notebook, SyncMeta } from "../types";

export const emptyMeta = (): SyncMeta => ({ cursor: null, notes: {}, deleted: [], notebooksRev: null, notebooksAt: 0 });
export const metaOf = (d: AppData): SyncMeta => d.sync ?? emptyMeta();

export const notePath = (id: string) => `/notes/${id}.json`;
export const NOTEBOOKS_PATH = "/notebooks.json";

export function noteIdFromPath(path: string): string | null {
  const m = path.match(/^\/notes\/([^/]+)\.json$/i);
  return m ? m[1] : null;
}

export interface NotebooksFile {
  notebooks: Notebook[];
  deleted: string[];
  defaultNotebookId: string;
  updatedAt: number;
}

export type RemoteChange =
  | { kind: "note"; id: string; rev: string; note: Note }
  | { kind: "delete"; id: string }
  | { kind: "notebooks"; rev: string; file: NotebooksFile };

/*
 * "Changed since last sync" compares the note's updatedAt with the exact value recorded at the
 * last sync (=== / !==), never with < or >: timestamps from different devices can't be compared
 * safely when one device's clock is off.
 */
const syncedVersion = (n: Note, m: SyncMeta) => !!m.notes[n.id] && n.updatedAt === m.notes[n.id].at;

/** Notes whose current version hasn't been uploaded yet. */
export function pendingNotes(d: AppData): Note[] {
  const m = metaOf(d);
  return d.notes.filter((n) => !syncedVersion(n, m));
}

export function notebooksPending(d: AppData): boolean {
  const m = metaOf(d);
  return !m.notebooksRev || (d.notebooksUpdatedAt ?? 0) !== m.notebooksAt;
}

export function notebooksFileOf(d: AppData): NotebooksFile {
  return {
    notebooks: d.notebooks,
    deleted: d.deletedNotebooks ?? [],
    defaultNotebookId: d.defaultNotebookId,
    updatedAt: d.notebooksUpdatedAt ?? 0,
  };
}

const sameContent = (a: Note, b: Note) =>
  a.title === b.title &&
  JSON.stringify(a.content) === JSON.stringify(b.content) &&
  a.notebookId === b.notebookId &&
  a.starred === b.starred &&
  !!a.pinned === !!b.pinned &&
  a.trashedAt === b.trashedAt &&
  a.tags.join("\u0000") === b.tags.join("\u0000");

const conflictedCopy = (n: Note, newId: string): Note => ({
  ...n,
  id: newId,
  title: `${n.title.trim() || "Untitled"} (conflicted copy)`,
  starred: false,
  pinned: false,
});

/**
 * Applies changes downloaded from Dropbox to local data.
 * Returns the new data and the ids of notes whose local content was replaced
 * (so an open editor can reload them).
 */
export function applyRemote(
  d: AppData,
  changes: RemoteChange[],
  cursor: string | null,
  newId: () => string,
): { data: AppData; touched: string[] } {
  const meta: SyncMeta = { ...metaOf(d), notes: { ...metaOf(d).notes }, deleted: [...metaOf(d).deleted] };
  let notes = [...d.notes];
  let out: AppData = d;
  const touched: string[] = [];
  const idx = (id: string) => notes.findIndex((n) => n.id === id);

  for (const ch of changes) {
    if (ch.kind === "note") {
      const { id, rev, note: remote } = ch;
      if (meta.deleted.includes(id)) continue; // deleted here; the delete will be uploaded
      const i = idx(id);
      const local = i >= 0 ? notes[i] : null;
      const m = meta.notes[id];

      if (!local) {
        notes.unshift(remote);
        meta.notes[id] = { rev, at: remote.updatedAt };
        touched.push(id);
      } else if (sameContent(local, remote)) {
        // Same note on both sides; just record the revision.
        meta.notes[id] = { rev, at: Math.max(local.updatedAt, remote.updatedAt) };
        if (remote.updatedAt > local.updatedAt) notes[i] = remote;
      } else if (syncedVersion(local, meta)) {
        // Only changed remotely: take it.
        notes[i] = remote;
        meta.notes[id] = { rev, at: remote.updatedAt };
        touched.push(id);
      } else if (local.updatedAt >= remote.updatedAt) {
        // Changed on both sides, local is newer: keep local (it will upload over this rev),
        // keep the other device's version as a copy.
        notes.unshift(conflictedCopy(remote, newId()));
        meta.notes[id] = { rev, at: -1 }; // stays "pending", so local gets uploaded
      } else {
        // Changed on both sides, remote is newer: take remote, keep ours as a copy.
        notes[i] = remote;
        notes.unshift(conflictedCopy(local, newId()));
        meta.notes[id] = { rev, at: remote.updatedAt };
        touched.push(id);
      }
    } else if (ch.kind === "delete") {
      const i = idx(ch.id);
      if (i >= 0 && syncedVersion(notes[i], meta)) {
        notes = notes.filter((n) => n.id !== ch.id);
        touched.push(ch.id);
      }
      // If it was edited here after the last sync, keep it: it gets uploaded again as new.
      delete meta.notes[ch.id];
    } else {
      out = mergeNotebooks({ ...out, notes }, ch.file);
      notes = out.notes;
      meta.notebooksRev = ch.rev;
      meta.notebooksAt = ch.file.updatedAt;
    }
  }

  if (cursor) meta.cursor = cursor;
  return { data: fixOrphans({ ...out, notes, sync: meta }), touched };
}

export const STARTER_NOTEBOOK_NAME = "First Notebook";

/**
 * Older versions created a "First Notebook" on every new device, so synced accounts can have several.
 * Keeps the oldest one and moves the notes of the others into it. Every device applies the same rule,
 * so notes are moved without changing their updatedAt (no conflicts, nothing to re-upload).
 */
export function dedupeStarterNotebooks(d: AppData): AppData {
  const starters = d.notebooks.filter((nb) => nb.name === STARTER_NOTEBOOK_NAME);
  if (starters.length < 2) return d;
  const keep = [...starters].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
  const drop = new Set(starters.filter((nb) => nb.id !== keep.id).map((nb) => nb.id));
  return {
    ...d,
    notebooks: d.notebooks.filter((nb) => !drop.has(nb.id)),
    deletedNotebooks: [...new Set([...(d.deletedNotebooks ?? []), ...drop])],
    defaultNotebookId: drop.has(d.defaultNotebookId) ? keep.id : d.defaultNotebookId,
    notes: d.notes.map((n) => (drop.has(n.notebookId) ? { ...n, notebookId: keep.id } : n)),
  };
}

/** Notes whose notebook no longer exists go to the default notebook. */
function fixOrphans(d: AppData): AppData {
  const ids = new Set(d.notebooks.map((nb) => nb.id));
  if (d.notes.every((n) => ids.has(n.notebookId))) return d;
  return { ...d, notes: d.notes.map((n) => (ids.has(n.notebookId) ? n : { ...n, notebookId: d.defaultNotebookId })) };
}

/** Combines local and remote notebook lists. Deletions on either side win. */
export function mergeNotebooks(d: AppData, remote: NotebooksFile): AppData {
  // A brand-new device starts with a placeholder notebook; once it sees the real notebooks
  // in Dropbox, the placeholder (if still empty) quietly disappears instead of syncing.
  if (d.placeholderNotebook && remote.notebooks.length) {
    const ph = d.placeholderNotebook;
    const used = d.notes.some((n) => n.notebookId === ph);
    d = {
      ...d,
      placeholderNotebook: undefined,
      notebooks: used ? d.notebooks : d.notebooks.filter((nb) => nb.id !== ph),
      defaultNotebookId: used ? d.defaultNotebookId : remote.defaultNotebookId,
    };
  }
  const localAt = d.notebooksUpdatedAt ?? 0;
  const deleted = [...new Set([...(d.deletedNotebooks ?? []), ...(remote.deleted ?? [])])];
  const byId = new Map<string, Notebook>();
  for (const nb of remote.notebooks) byId.set(nb.id, nb);
  for (const nb of d.notebooks) {
    if (!byId.has(nb.id) || localAt > remote.updatedAt) byId.set(nb.id, nb);
  }
  let merged = [...byId.values()].filter((nb) => !deleted.includes(nb.id));
  if (merged.length === 0) merged = d.notebooks.length ? [d.notebooks[0]] : remote.notebooks.slice(0, 1);

  const has = (id: string) => merged.some((nb) => nb.id === id);
  const defaultNotebookId = has(d.defaultNotebookId)
    ? d.defaultNotebookId
    : has(remote.defaultNotebookId)
      ? remote.defaultNotebookId
      : merged[0].id;

  const sig = (list: Notebook[], del: string[]) =>
    JSON.stringify([list.map((n) => [n.id, n.name]).sort(), [...del].sort()]);
  const sameAsRemote = sig(merged, deleted) === sig(remote.notebooks.filter((n) => !deleted.includes(n.id)), remote.deleted ?? []);
  // If our merge added something the remote file doesn't have, mark it as newer so it gets uploaded.
  const notebooksUpdatedAt = sameAsRemote ? remote.updatedAt : Math.max(Date.now(), localAt, remote.updatedAt + 1);

  // Notes in a notebook that no longer exists move to the default notebook.
  const notes = d.notes.map((n) => (has(n.notebookId) ? n : { ...n, notebookId: defaultNotebookId }));

  const result = dedupeStarterNotebooks({ ...d, notes, notebooks: merged, deletedNotebooks: deleted, defaultNotebookId, notebooksUpdatedAt });
  // If de-duplicating changed the list, make sure the cleaned-up list gets uploaded.
  return result.notebooks.length !== merged.length ? { ...result, notebooksUpdatedAt: Math.max(Date.now(), notebooksUpdatedAt + 1) } : result;
}

export function markUploaded(d: AppData, id: string, rev: string, at: number): AppData {
  const m = metaOf(d);
  return { ...d, sync: { ...m, notes: { ...m.notes, [id]: { rev, at } } } };
}

export function markRemoteDeleted(d: AppData, id: string): AppData {
  const m = metaOf(d);
  const notes = { ...m.notes };
  delete notes[id];
  return { ...d, sync: { ...m, notes, deleted: m.deleted.filter((x) => x !== id) } };
}

export function markNotebooksUploaded(d: AppData, rev: string, at: number): AppData {
  return { ...d, sync: { ...metaOf(d), notebooksRev: rev, notebooksAt: at } };
}

/** Removes notes locally and remembers synced ones so the deletion reaches Dropbox. */
export function removeNotes(d: AppData, ids: string[]): AppData {
  const m = d.sync;
  const notes = d.notes.filter((n) => !ids.includes(n.id));
  if (!m) return { ...d, notes };
  const toDelete = ids.filter((id) => m.notes[id] && !m.deleted.includes(id));
  return { ...d, notes, sync: { ...m, deleted: [...m.deleted, ...toDelete] } };
}
