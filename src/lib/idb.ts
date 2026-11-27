/**
 * Small IndexedDB helpers.
 *  - "kv":     key-value (web: app data without the notes; small settings)
 *  - "notes":  web version, one entry per note (only changed notes are written)
 *  - "images": pictures in notes, on every platform (see lib/images.ts)
 */
const DB = "notewell";
export type Store = "kv" | "notes" | "images";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ["kv", "notes", "images"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbGet<T>(key: string, store: Store = "kv"): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetAll<T>(store: Store): Promise<T[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function idbKeys(store: Store): Promise<string[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAllKeys();
    req.onsuccess = () => resolve(req.result.map(String));
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key: string, value: unknown, store: Store = "kv"): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value, key);
  return done(tx);
}

export async function idbDelete(key: string, store: Store = "kv"): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  return done(tx);
}

/** Several writes and deletes across stores in one transaction (all or nothing). */
export async function idbBatch(ops: { store: Store; key: string; value?: unknown; del?: boolean }[]): Promise<void> {
  if (!ops.length) return;
  const db = await open();
  const stores = [...new Set(ops.map((o) => o.store))];
  const tx = db.transaction(stores, "readwrite");
  for (const o of ops) {
    const s = tx.objectStore(o.store);
    if (o.del) s.delete(o.key);
    else s.put(o.value, o.key);
  }
  return done(tx);
}
