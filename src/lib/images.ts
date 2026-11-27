/**
 * Pictures in notes.
 *
 * A note only holds an image *reference* (node "noteImage" with attrs.id); the picture itself lives on
 * the device (desktop: files in the data folder, images/<id>.dataurl — see src-tauri/src/files.rs;
 * web/iPhone: IndexedDB "images" store) and in Dropbox at /images/<id>.dataurl,
 * so notes stay small and fast to save/sync. Pictures are shrunk before storing (max 1800px).
 * Devices fetch a picture from Dropbox the first time a note shows it.
 */
import { idbDelete, idbGet, idbKeys, idbSet } from "./idb";
import { isTauri } from "./storage";
import { uid } from "./util";

const MAX_SIDE = 1800;
const PENDING_KEY = "images-pending";
export const imagePath = (id: string) => `/images/${id}.dataurl`;
export const IMAGE_THUMB_PREFIX = "nwimg:";

interface Stored {
  data: string;
}

// ---- Where pictures are kept on this device ----
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

/**
 * Desktop, once: pictures from older versions (kept in the web view's storage, which the system may
 * clear) move to files. Each one is removed from the old place only after its file is written.
 */
let migrated: Promise<void> | null = null;
function migrateToFiles(): Promise<void> {
  migrated ??= (async () => {
    try {
      for (const id of await idbKeys("images")) {
        const old = await idbGet<Stored>(id, "images");
        if (old?.data) {
          const exists = await invoke<string | null>("image_file_read", { name: `${id}.dataurl` });
          if (!exists) await invoke("image_file_write", { name: `${id}.dataurl`, contents: old.data });
        }
        await idbDelete(id, "images");
      }
      const oldPending = await idbGet<string[]>(PENDING_KEY);
      if (oldPending?.length) {
        const now = await readPendingFile();
        await writePendingFile([...new Set([...now, ...oldPending])]);
      }
      if (oldPending) await idbDelete(PENDING_KEY);
    } catch (e) {
      console.warn("Moving pictures to files:", e);
    }
  })();
  return migrated;
}

async function readPendingFile(): Promise<string[]> {
  const raw = await invoke<string | null>("image_file_read", { name: "pending.json" });
  try {
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
const writePendingFile = (list: string[]) => invoke("image_file_write", { name: "pending.json", contents: JSON.stringify(list) });

async function readStored(id: string): Promise<string | null> {
  if (!isTauri) return (await idbGet<Stored>(id, "images"))?.data ?? null;
  await migrateToFiles();
  return invoke<string | null>("image_file_read", { name: `${id}.dataurl` });
}
async function writeStored(id: string, data: string): Promise<void> {
  if (!isTauri) return idbSet(id, { data } satisfies Stored, "images");
  await migrateToFiles();
  await invoke("image_file_write", { name: `${id}.dataurl`, contents: data });
}
async function readPending(): Promise<string[]> {
  if (!isTauri) return (await idbGet<string[]>(PENDING_KEY)) ?? [];
  await migrateToFiles();
  return readPendingFile();
}
async function writePending(list: string[]): Promise<void> {
  if (!isTauri) return idbSet(PENDING_KEY, list);
  await migrateToFiles();
  await writePendingFile(list);
}

const memory = new Map<string, Promise<string>>();
let remoteLoader: ((id: string) => Promise<string>) | null = null;
const listeners = new Set<() => void>();

/** The sync engine registers how to download a picture that isn't on this device yet. */
export function setRemoteImageLoader(fn: ((id: string) => Promise<string>) | null) {
  remoteLoader = fn;
  if (fn) listeners.forEach((l) => l()); // let missing pictures try again
}
export function onImageLoaderChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Shrinks large photos (JPEG); keeps small PNG/GIF (screenshots, transparency) as they are. */
async function prepare(file: Blob): Promise<string> {
  const keep = /png|gif|webp/.test(file.type) && file.size < 600_000;
  if (keep || file.type === "image/svg+xml") return readAsDataUrl(file);
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return readAsDataUrl(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 900_000) {
    bitmap.close();
    return readAsDataUrl(file);
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent areas become white in a JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Stores a picture on this device (queued for upload) and returns its id. */
export async function addImage(file: Blob): Promise<string> {
  const data = await prepare(file);
  return addImageData(data);
}

export async function addImageData(data: string, id = uid() + uid()): Promise<string> {
  await writeStored(id, data);
  memory.set(id, Promise.resolve(data));
  const pending = await readPending();
  if (!pending.includes(id)) await writePending([...pending, id]);
  window.dispatchEvent(new Event("notewell:images-changed"));
  return id;
}

/** Picture data for display: from this device, else downloaded from Dropbox (and kept). */
export function loadImage(id: string): Promise<string> {
  let p = memory.get(id);
  if (!p) {
    p = (async () => {
      const local = await readStored(id);
      if (local) return local;
      if (!remoteLoader) throw new Error("not-synced");
      const data = await remoteLoader(id);
      await writeStored(id, data);
      return data;
    })();
    memory.set(id, p);
    p.catch(() => memory.delete(id));
  }
  return p;
}

/** Picture data if it's on this device (for backups); null otherwise. */
export async function localImage(id: string): Promise<string | null> {
  return readStored(id);
}

export async function pendingImageUploads(): Promise<string[]> {
  return readPending();
}

export async function markImageUploaded(id: string) {
  const pending = await readPending();
  await writePending(pending.filter((x) => x !== id));
}

/** All picture ids used in a note body. */
export function imageIds(node: { type?: string; attrs?: Record<string, any>; content?: any[] } | null | undefined, out: string[] = []): string[] {
  if (!node) return out;
  if (node.type === "noteImage" && node.attrs?.id) out.push(node.attrs.id);
  node.content?.forEach((c) => imageIds(c, out));
  return out;
}

/** Picture files chosen in a file picker / pasted / dropped. */
export function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const files: File[] = [];
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const f = item instanceof File ? item : item.kind === "file" ? item.getAsFile() : null;
    if (f && f.type.startsWith("image/")) files.push(f);
  }
  return files;
}
