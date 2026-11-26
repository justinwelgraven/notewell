import type { JSONContent } from "@tiptap/core";

export interface Note {
  id: string;
  title: string;
  content: JSONContent | null;
  /** Plain text of the body, used for list snippets and search. */
  text: string;
  /** First image found in the note (link preview / video), shown as list thumbnail. */
  thumb: string | null;
  notebookId: string;
  tags: string[];
  starred: boolean;
  trashedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Notebook {
  id: string;
  name: string;
  createdAt: number;
}

/** Bookkeeping for Dropbox sync: what was last uploaded/downloaded. */
export interface SyncMeta {
  /** Dropbox list_folder cursor: "changes since". */
  cursor: string | null;
  /** Per note: Dropbox revision and the note's updatedAt at that revision. */
  notes: Record<string, { rev: string; at: number }>;
  /** Notes permanently deleted here that still need deleting in Dropbox. */
  deleted: string[];
  notebooksRev: string | null;
  /** notebooksUpdatedAt that matches notebooksRev. */
  notebooksAt: number;
}

export interface AppData {
  version: 1;
  notes: Note[];
  notebooks: Notebook[];
  defaultNotebookId: string;
  /** Bumped whenever notebooks are added, renamed or deleted. */
  notebooksUpdatedAt?: number;
  /** Ids of deleted notebooks, so the deletion syncs to other devices. */
  deletedNotebooks?: string[];
  sync?: SyncMeta;
  /** Set on a brand-new device: the id of the empty notebook created so there is somewhere to put notes.
   *  It's dropped in favour of the real notebooks on first sync. */
  placeholderNotebook?: string;
}

export type View =
  | { kind: "all" }
  | { kind: "shortcuts" }
  | { kind: "notebook"; id: string }
  | { kind: "tag"; tag: string }
  | { kind: "trash" };

export type SortMode = "updated" | "created" | "title";
