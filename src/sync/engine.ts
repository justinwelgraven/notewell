/**
 * Dropbox sync engine (runs in the main window, which owns the notes).
 *
 *  - pull: asks Dropbox what changed since the last cursor, downloads changed notes, merges them
 *  - push: uploads notes edited here (1.5 s after typing stops) and deletions
 *  - live: a long-poll request waits for changes from other devices and pulls within seconds
 *
 * All work goes through one queue so pull and push never overlap.
 */
import type { AppData, Note } from "../types";
import { uid } from "../lib/util";
import { DropboxError, download, longpoll, rpc, upload } from "./dropbox";
import {
  NOTEBOOKS_PATH,
  applyRemote,
  markNotebooksUploaded,
  markRemoteDeleted,
  markUploaded,
  metaOf,
  noteIdFromPath,
  notePath,
  notebooksFileOf,
  notebooksPending,
  pendingNotes,
  type NotebooksFile,
  type RemoteChange,
} from "./merge";

export type SyncState = "syncing" | "synced" | "offline" | "error";
export interface SyncStatus {
  state: SyncState;
  lastSync: number | null;
  message?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Lets React apply a state update so getData() returns the merged result. */
const settle = () => sleep(60);

interface ListResult {
  entries: { ".tag": "file" | "folder" | "deleted"; path_display: string; path_lower: string; rev?: string }[];
  cursor: string;
  has_more: boolean;
}

export class SyncEngine {
  private running = false;
  private queue: Promise<void> = Promise.resolve();
  private pushTimer: number | undefined;
  private status: SyncStatus = { state: "syncing", lastSync: null };

  constructor(
    private getData: () => AppData | null,
    private update: (fn: (d: AppData) => AppData) => void,
    private onStatus: (s: SyncStatus) => void,
    private onRemoteChanged: (noteIds: string[]) => void,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.enqueue(() => this.fullSync());
    void this.liveLoop();
  }

  stop() {
    this.running = false;
    window.clearTimeout(this.pushTimer);
  }

  /** Call after any local change; uploads once typing pauses. */
  schedulePush() {
    if (!this.running) return;
    window.clearTimeout(this.pushTimer);
    this.pushTimer = window.setTimeout(() => {
      const d = this.getData();
      if (d && (pendingNotes(d).length || metaOf(d).deleted.length || notebooksPending(d))) {
        this.enqueue(() => this.push());
      }
    }, 1500);
  }

  syncNow() {
    return this.enqueue(() => this.fullSync());
  }

  private setStatus(s: Partial<SyncStatus>) {
    this.status = { ...this.status, ...s };
    this.onStatus(this.status);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.running) return;
      this.setStatus({ state: "syncing", message: undefined });
      try {
        await task();
        this.setStatus({ state: "synced", lastSync: Date.now() });
      } catch (e) {
        const err = e instanceof DropboxError ? e : new DropboxError(0, String(e));
        console.warn("Sync failed:", err);
        if (err.offline) {
          this.setStatus({ state: "offline", message: "Will sync when back online" });
          window.setTimeout(() => this.running && this.enqueue(() => this.fullSync()), 20000);
        } else if (err.status === 401 || /Not connected/.test(err.summary)) {
          this.setStatus({ state: "error", message: "Dropbox access expired, please reconnect" });
        } else {
          this.setStatus({ state: "error", message: err.summary.slice(0, 160) });
          window.setTimeout(() => this.running && this.enqueue(() => this.fullSync()), 60000);
        }
      }
    });
    return this.queue;
  }

  private async fullSync() {
    await this.pull();
    await this.push();
  }

  private async listChanges(): Promise<ListResult> {
    const cursor = metaOf(this.getData()!).cursor;
    let res: ListResult;
    if (cursor) {
      try {
        res = await rpc<ListResult>("files/list_folder/continue", { cursor });
      } catch (e) {
        if (e instanceof DropboxError && e.is("reset")) {
          res = await rpc<ListResult>("files/list_folder", { path: "", recursive: true, include_deleted: true });
        } else throw e;
      }
    } else {
      res = await rpc<ListResult>("files/list_folder", { path: "", recursive: true, include_deleted: true });
    }
    const entries = [...res.entries];
    while (res.has_more) {
      res = await rpc<ListResult>("files/list_folder/continue", { cursor: res.cursor });
      entries.push(...res.entries);
    }
    return { entries, cursor: res.cursor, has_more: false };
  }

  private async pull() {
    const { entries, cursor } = await this.listChanges();
    const meta = metaOf(this.getData()!);
    const changes: RemoteChange[] = [];

    for (const e of entries) {
      if (e[".tag"] === "file") {
        const id = noteIdFromPath(e.path_display);
        if (id) {
          if (meta.notes[id]?.rev === e.rev) continue; // our own upload, or already have it
          try {
            const { text, meta: fm } = await download(e.path_display);
            const note = JSON.parse(text) as Note;
            if (note && note.id === id) changes.push({ kind: "note", id, rev: fm.rev ?? e.rev!, note });
          } catch (err) {
            if (err instanceof DropboxError && err.is("path/not_found")) continue; // deleted meanwhile
            throw err;
          }
        } else if (e.path_lower === NOTEBOOKS_PATH && e.rev !== meta.notebooksRev) {
          const { text, meta: fm } = await download(NOTEBOOKS_PATH);
          changes.push({ kind: "notebooks", rev: fm.rev ?? e.rev!, file: JSON.parse(text) as NotebooksFile });
        }
      } else if (e[".tag"] === "deleted") {
        const id = noteIdFromPath(e.path_display);
        if (id && meta.notes[id]) changes.push({ kind: "delete", id });
      }
    }

    let touched: string[] = [];
    this.update((d) => {
      const r = applyRemote(d, changes, cursor, uid);
      touched = r.touched;
      return r.data;
    });
    await settle();
    if (touched.length) this.onRemoteChanged(touched);
  }

  private async push(depth = 0) {
    const d = this.getData();
    if (!d) return;
    const meta = metaOf(d);
    let needPull = false;

    for (const id of meta.deleted) {
      try {
        await rpc("files/delete_v2", { path: notePath(id) });
      } catch (e) {
        if (!(e instanceof DropboxError && e.is("path_lookup/not_found"))) throw e;
      }
      this.update((x) => markRemoteDeleted(x, id));
    }

    for (const note of pendingNotes(d)) {
      try {
        const fm = await upload(notePath(note.id), JSON.stringify(note), meta.notes[note.id]?.rev ?? null);
        this.update((x) => markUploaded(x, note.id, fm.rev, note.updatedAt));
      } catch (e) {
        if (e instanceof DropboxError && e.is("path/conflict")) needPull = true;
        else throw e;
      }
    }

    if (notebooksPending(d)) {
      const file = notebooksFileOf(d);
      try {
        const fm = await upload(NOTEBOOKS_PATH, JSON.stringify(file), meta.notebooksRev);
        this.update((x) => markNotebooksUploaded(x, fm.rev, file.updatedAt));
      } catch (e) {
        if (e instanceof DropboxError && e.is("path/conflict")) needPull = true;
        else throw e;
      }
    }

    await settle();
    // Someone else changed a file we were uploading: merge their version, then upload again.
    if (needPull && depth < 2) {
      await this.pull();
      await this.push(depth + 1);
    }
  }

  /** Waits for changes from other devices; pulls as soon as Dropbox reports one. */
  private async liveLoop() {
    let backoff = 5;
    while (this.running) {
      const cursor = this.getData() ? metaOf(this.getData()!).cursor : null;
      if (!cursor) {
        await sleep(2000);
        continue;
      }
      try {
        const r = await longpoll(cursor, 120);
        backoff = 5;
        if (r.changes && this.running) await this.enqueue(() => this.pull());
        if (r.backoff) await sleep(r.backoff * 1000);
      } catch (e) {
        if (e instanceof DropboxError && e.is("reset")) {
          await this.enqueue(() => this.fullSync());
        } else {
          await sleep(backoff * 1000);
          backoff = Math.min(backoff * 2, 60);
        }
      }
    }
  }
}
