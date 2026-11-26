import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Note, SortMode, View } from "./types";
import { isTauri, loadData, onAppClose, openQuickNote, saveData } from "./lib/storage";
import { listen } from "@tauri-apps/api/event";
import { Resizer, useStoredNumber } from "./components/Resizer";
import { docText, seedData, uid } from "./lib/util";
import Sidebar from "./components/Sidebar";
import NoteList from "./components/NoteList";
import EditorPane from "./components/EditorPane";
import { ConfirmDialog, PromptDialog } from "./components/Menu";
import { Icon } from "./components/Icon";
import { SyncEngine, type SyncStatus } from "./sync/engine";
import {
  completeWebSignIn,
  connectDropbox,
  disconnectDropbox,
  dropboxStatus,
  finishWebSignInWithCode,
  NEEDS_CODE,
  cancelCodeSignIn,
  pendingCodeSignIn,
  restoreWebAuth,
  type DropboxStatus,
} from "./sync/dropbox";
import { dedupeStarterNotebooks, removeNotes } from "./sync/merge";
import ShortcutsDialog from "./components/ShortcutsDialog";
import DropboxCodeDialog from "./components/DropboxCodeDialog";
import NoteActions from "./components/NoteActions";
import Rail from "./components/Rail";
import { syncLabel } from "./components/Sidebar";
import { checkForUpdate, type AvailableUpdate } from "./lib/updater";
import { watchWebUpdates } from "./lib/webUpdate";
import { onStaleViewport } from "./lib/viewport";

export interface SyncUi {
  dropbox: DropboxStatus;
  status: SyncStatus | null;
  connecting: boolean;
  /** iPhone Home Screen app: waiting for the code Dropbox shows. */
  awaitingCode: boolean;
  submitCode: (code: string) => void;
  error: string | null;
  connect: (appKey: string) => void;
  disconnect: () => void;
  syncNow: () => void;
}

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

const SB_DEFAULT = 240;
const LIST_DEFAULT = 340;

type Dialog =
  | { kind: "newNotebook" }
  | { kind: "renameNotebook"; id: string }
  | { kind: "deleteNotebook"; id: string }
  | { kind: "deleteNote"; id: string }
  | { kind: "emptyTrash" };

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  // After an automatic reload (iPhone screen-size fix), come back to the same place.
  const [restored] = useState(() => {
    try {
      const raw = sessionStorage.getItem("notewell-ui-restore");
      sessionStorage.removeItem("notewell-ui-restore");
      return raw ? (JSON.parse(raw) as { view: View; selectedId: string | null; mobilePane: "list" | "editor" }) : null;
    } catch {
      return null;
    }
  });
  const [view, setView] = useState<View>(restored?.view ?? { kind: "all" });
  const [selectedId, setSelectedId] = useState<string | null>(restored?.selectedId ?? null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>(() => (localStorage.getItem("notewell-sort") as SortMode) || "updated");
  const [focusMode, setFocusMode] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Screen sizes:
  //  - narrow (< 600 px): phone, or iPhone Duo folded — one screen at a time
  //  - medium (600–1099 px): iPhone Duo unfolded, iPad portrait, narrow window — list + note side by side,
  //    sidebar as a drawer
  //  - wide: the full three-column desktop layout
  // Phone layout also when the screen is low (iPhone Duo folded and turned sideways): too small for two panes.
  const narrow = useMediaQuery("(max-width: 599px), (max-height: 499px)");
  const medium = useMediaQuery("(min-width: 600px) and (max-width: 1099px) and (min-height: 500px)");
  const compact = narrow || medium;
  // iPhone Duo unfolded sideways / iPad: a slim icon rail instead of only the ☰ drawer.
  const railWide = useMediaQuery("(min-width: 820px)");
  const showRail = medium && railWide;
  // Long-press / right-click menu on a note in the list.
  const [noteMenu, setNoteMenu] = useState<{ id: string; at: { x: number; y: number } | null } | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "editor">(restored?.mobilePane ?? "list");

  // iPhone: when iOS gets stuck with a too-small screen size after rotating, save and reload once.
  const uiRef = useRef({ view, selectedId, mobilePane });
  uiRef.current = { view, selectedId, mobilePane };
  useEffect(() => {
    if (isTauri) return;
    onStaleViewport(async () => {
      try {
        if (dataRef.current) await saveData(dataRef.current);
      } catch {}
      sessionStorage.setItem("notewell-ui-restore", JSON.stringify(uiRef.current));
      location.reload();
    });
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dataRef = useRef<AppData | null>(null);
  dataRef.current = data;
  const searchRef = useRef<HTMLInputElement>(null);
  const [sbWidth, setSbWidth] = useStoredNumber("notewell-w-sidebar", SB_DEFAULT);
  const [listWidth, setListWidth] = useStoredNumber("notewell-w-list", LIST_DEFAULT);
  // Bumped when the quick-note window changes a note, so an open editor reloads it.
  const [quickRev, setQuickRev] = useState<Record<string, number>>({});

  // ---- Load & persist ----
  useEffect(() => {
    loadData()
      .then((d) => {
        const data = d ?? seedData();
        // Fill in list previews for notes that have never been opened on this device.
        const notes = data.notes.map((n) => (!n.text && n.content ? { ...n, text: docText(n.content) } : n));
        const cleaned = dedupeStarterNotebooks({ ...data, notes });
        // If duplicate notebooks were merged, upload the cleaned-up list so every device gets it.
        setData(cleaned.notebooks.length !== data.notebooks.length ? { ...cleaned, notebooksUpdatedAt: Date.now() } : cleaned);
      })
      .catch((e) => setLoadError(String(e)));
    const unlisten = onAppClose(() => dataRef.current);
    // Closing the window hides it to the tray: save straight away rather than waiting for the autosave.
    const onHide = () => {
      if (document.visibilityState === "hidden" && dataRef.current) saveData(dataRef.current).catch(() => {});
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      unlisten.then((fn) => fn());
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // ---- Notes coming from the quick-note window (Ctrl+Alt+N) ----
  useEffect(() => {
    if (!isTauri || !data) return;
    const offs = [
      listen<Note>("quick-note", ({ payload: note }) => {
        const empty = !note.title.trim() && !note.text.trim() && !note.thumb;
        setData((d) => {
          if (!d) return d;
          const exists = d.notes.some((n) => n.id === note.id);
          if (empty) return exists ? removeNotes(d, [note.id]) : d;
          const fixed = d.notebooks.some((nb) => nb.id === note.notebookId) ? note : { ...note, notebookId: d.defaultNotebookId };
          return { ...d, notes: exists ? d.notes.map((n) => (n.id === note.id ? fixed : n)) : [fixed, ...d.notes] };
        });
        setQuickRev((r) => ({ ...r, [note.id]: (r[note.id] ?? 0) + 1 }));
      }),
      listen<string>("quick-note-open", async ({ payload: id }) => {
        setView({ kind: "all" });
        setSearch("");
        setSelectedId(id);
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        await w.unminimize();
        await w.show();
        await w.setFocus();
      }),
    ];
    return () => offs.forEach((p) => p.then((off) => off()));
  }, [!!data]);

  useEffect(() => {
    if (!data) return;
    setSaveState("saving");
    const t = setTimeout(() => {
      saveData(data)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 500);
    return () => clearTimeout(t);
  }, [data]);

  useEffect(() => localStorage.setItem("notewell-sort", sort), [sort]);

  // ---- Dropbox sync ----
  const [dbx, setDbx] = useState<DropboxStatus>({ connected: false, account: null, app_key: null });
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Web (Home Screen app): a Dropbox sign-in waiting for its code — also after iOS restarted the app.
  const [awaitingCode, setAwaitingCode] = useState(() => !isTauri && !!pendingCodeSignIn());
  const [syncError, setSyncError] = useState<string | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    // Web: if we just came back from Dropbox's sign-in page, finish connecting first.
    (isTauri ? Promise.resolve(null) : restoreWebAuth().then(() => completeWebSignIn()))
      .catch((e) => setSyncError(String(e)))
      .then(() => dropboxStatus())
      .then(setDbx)
      .catch(() => {});
  }, []);

  const loaded = !!data;
  useEffect(() => {
    if (!loaded || !dbx.connected) return;
    const engine = new SyncEngine(
      () => dataRef.current,
      (fn) => setData((d) => (d ? fn(d) : d)),
      setSyncStatus,
      // Reload an open editor when its note was changed on another device.
      (ids) => setQuickRev((r) => Object.fromEntries([...Object.entries(r), ...ids.map((id) => [id, (r[id] ?? 0) + 1])])),
    );
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [loaded, dbx.connected]);

  useEffect(() => {
    engineRef.current?.schedulePush();
  }, [data]);

  const syncUi: SyncUi = {
    dropbox: dbx,
    status: syncStatus,
    connecting,
    awaitingCode,
    error: syncError,
    connect: (appKey) => {
      setConnecting(true);
      setSyncError(null);
      connectDropbox(appKey.trim())
        .then(async (result) => {
          if (result === NEEDS_CODE) setAwaitingCode(true);
          else setDbx(await dropboxStatus());
        })
        .catch((e) => setSyncError(String(e)))
        .finally(() => setConnecting(false));
    },
    submitCode: (code) => {
      setConnecting(true);
      setSyncError(null);
      finishWebSignInWithCode(code)
        .then(async () => {
          setAwaitingCode(false);
          setDbx(await dropboxStatus());
        })
        .catch((e) => setSyncError(String(e)))
        .finally(() => setConnecting(false));
    },
    disconnect: () => {
      disconnectDropbox()
        .catch(() => {})
        .then(() => {
          // Forget sync bookkeeping; reconnecting starts a fresh, safe merge.
          setData((d) => (d ? { ...d, sync: undefined } : d));
          setSyncStatus(null);
          setDbx({ connected: false, account: null, app_key: dbx.app_key });
        });
    },
    syncNow: () => engineRef.current?.syncNow(),
  };

  // ---- Derived ----
  const allTags = useMemo(() => {
    const s = new Set<string>();
    data?.notes.forEach((n) => !n.trashedAt && n.tags.forEach((t) => s.add(t)));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const visibleNotes = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let list = data.notes.filter((n) => {
      if (view.kind === "trash") return n.trashedAt !== null;
      if (n.trashedAt !== null) return false;
      if (view.kind === "shortcuts") return n.starred;
      if (view.kind === "notebook") return n.notebookId === view.id;
      if (view.kind === "tag") return n.tags.includes(view.tag);
      return true;
    });
    if (q) {
      list = list.filter(
        (n) => n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    const sorted = [...list];
    if (sort === "title") sorted.sort((a, b) => (a.title || "Untitled").localeCompare(b.title || "Untitled"));
    else if (sort === "created") sorted.sort((a, b) => b.createdAt - a.createdAt);
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted;
  }, [data, view, search, sort]);

  // Keep a valid selection when the list changes.
  useEffect(() => {
    if (!data) return;
    if (!selectedId || !visibleNotes.some((n) => n.id === selectedId)) {
      setSelectedId(visibleNotes[0]?.id ?? null);
    }
  }, [visibleNotes]);

  const selected = data?.notes.find((n) => n.id === selectedId) ?? null;

  // ---- Actions ----
  const updateNote = useCallback((id: string, patch: Partial<Note>) => {
    setData((d) =>
      d && {
        ...d,
        notes: d.notes.map((n) => (n.id === id ? { ...n, updatedAt: Date.now(), ...patch } : n)),
      },
    );
  }, []);

  const createNote = useCallback(() => {
    if (!data) return;
    const now = Date.now();
    const notebookId = view.kind === "notebook" ? view.id : data.defaultNotebookId;
    const note: Note = {
      id: uid(),
      title: "",
      content: null,
      text: "",
      thumb: null,
      notebookId,
      tags: view.kind === "tag" ? [view.tag] : [],
      starred: view.kind === "shortcuts",
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    setData((d) => d && { ...d, notes: [note, ...d.notes] });
    if (view.kind === "trash") setView({ kind: "all" });
    setSearch("");
    setSelectedId(note.id);
    setMobilePane("editor");
  }, [data, view]);

  const duplicateNote = (id: string) => {
    if (!data) return;
    const src = data.notes.find((n) => n.id === id);
    if (!src) return;
    const now = Date.now();
    const copy: Note = { ...src, id: uid(), title: `${src.title || "Untitled"} (copy)`, starred: false, createdAt: now, updatedAt: now };
    setData((d) => d && { ...d, notes: [copy, ...d.notes] });
    setSelectedId(copy.id);
  };

  const trashNote = (id: string) => updateNote(id, { trashedAt: Date.now() });
  const restoreNote = (id: string) => {
    if (!data) return;
    const note = data.notes.find((n) => n.id === id);
    // If its notebook was deleted, restore into the default notebook.
    const nbExists = data.notebooks.some((nb) => nb.id === note?.notebookId);
    updateNote(id, { trashedAt: null, ...(nbExists ? {} : { notebookId: data.defaultNotebookId }) });
  };

  const createNotebook = (name: string) => {
    if (!data) return;
    const nb = { id: uid(), name, createdAt: Date.now() };
    setData((d) => d && { ...d, notebooks: [...d.notebooks, nb], notebooksUpdatedAt: Date.now() });
    setView({ kind: "notebook", id: nb.id });
  };

  const renameNotebook = (id: string, name: string) =>
    setData((d) => d && { ...d, notebooks: d.notebooks.map((nb) => (nb.id === id ? { ...nb, name } : nb)), notebooksUpdatedAt: Date.now() });

  const deleteNotebook = (id: string) => {
    if (!data || data.notebooks.length <= 1) return;
    const now = Date.now();
    setData((d) => {
      if (!d || d.notebooks.length <= 1) return d;
      const remaining = d.notebooks.filter((nb) => nb.id !== id);
      return {
        ...d,
        notebooks: remaining,
        deletedNotebooks: [...(d.deletedNotebooks ?? []), id],
        notebooksUpdatedAt: now,
        defaultNotebookId: d.defaultNotebookId === id ? remaining[0].id : d.defaultNotebookId,
        notes: d.notes.map((n) => (n.notebookId === id && !n.trashedAt ? { ...n, trashedAt: now, updatedAt: now } : n)),
      };
    });
    if (view.kind === "notebook" && view.id === id) setView({ kind: "all" });
  };

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const dialogOpen = !!document.querySelector(".modal");
      if (dialogOpen && e.key !== "Escape") return;
      if (mod && !e.shiftKey && !e.altKey && key === "n") {
        e.preventDefault();
        createNote();
      } else if (mod && e.shiftKey && key === "n") {
        e.preventDefault();
        setDialog({ kind: "newNotebook" });
      } else if (mod && !e.altKey && key === "f") {
        e.preventDefault();
        setFocusMode(false);
        setTimeout(() => searchRef.current?.focus(), 0);
      } else if (mod && e.shiftKey && key === "t") {
        e.preventDefault();
        window.dispatchEvent(new Event("notewell:focus-tags"));
      } else if (mod && (key === "/" || key === "?" || e.code === "Slash" || e.code === "NumpadDivide")) {
        e.preventDefault();
        setShowShortcuts((s) => !s);
      } else if (e.key === "F11") {
        e.preventDefault();
        setFocusMode((f) => !f);
      } else if (e.key === "Escape" && focusMode && !document.querySelector(".modal, .dropdown-panel")) {
        setFocusMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNote, focusMode]);

  // ---- Note list keyboard: arrows, Enter, Delete/Backspace ----
  const listRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);

  // ---- Web version: a newer version was published and downloaded ----
  const [webUpdate, setWebUpdate] = useState(false);
  useEffect(() => (isTauri ? undefined : watchWebUpdates(() => setWebUpdate(true))), []);

  // ---- Automatic updates (desktop) ----
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    const run = () => checkForUpdate().then((u) => u && setUpdate(u));
    const first = setTimeout(run, 8000);
    const every = setInterval(run, 6 * 60 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
  const installUpdate = async () => {
    if (!update) return;
    setInstalling(true);
    try {
      if (dataRef.current) await saveData(dataRef.current); // never lose a note to an update
      await update.install();
    } catch (e) {
      setInstalling(false);
      setToast({ text: `Update failed: ${String(e).slice(0, 120)}` });
    }
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // "Escape" in the editor hands focus back to the list (EditorPane dispatches this).
  useEffect(() => {
    const focusList = () => listRef.current?.focus();
    const shortcuts = () => setShowShortcuts(true);
    window.addEventListener("notewell:focus-list", focusList);
    window.addEventListener("notewell:shortcuts", shortcuts);
    return () => {
      window.removeEventListener("notewell:focus-list", focusList);
      window.removeEventListener("notewell:shortcuts", shortcuts);
    };
  }, []);

  // Keep the selected card visible when moving with the keyboard.
  useEffect(() => {
    if (selectedId) document.getElementById(`note-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const i = visibleNotes.findIndex((n) => n.id === selectedId);
    const go = (j: number) => {
      const n = visibleNotes[Math.max(0, Math.min(visibleNotes.length - 1, j))];
      if (n) setSelectedId(n.id);
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        go(i + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        go(i - 1);
        break;
      case "Home":
        e.preventDefault();
        go(0);
        break;
      case "End":
        e.preventDefault();
        go(visibleNotes.length - 1);
        break;
      case "Enter":
        e.preventDefault();
        window.dispatchEvent(new Event("notewell:focus-editor"));
        break;
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        if (!selectedId || i < 0) break;
        if (view.kind === "trash") {
          setDialog({ kind: "deleteNote", id: selectedId });
          break;
        }
        const id = selectedId;
        const next = visibleNotes[i + 1] ?? visibleNotes[i - 1];
        const title = visibleNotes[i].title.trim() || "Untitled";
        trashNote(id);
        setSelectedId(next?.id ?? null);
        setToast({
          text: `“${title.length > 40 ? title.slice(0, 40) + "…" : title}” moved to Trash`,
          undo: () => {
            restoreNote(id);
            setSelectedId(id);
            listRef.current?.focus();
          },
        });
        break;
      }
    }
  };

  if (loadError) {
    return <div className="app-loading">Couldn't load your notes: {loadError}</div>;
  }
  if (!data) return <div className="app-loading">Loading…</div>;

  const nbName = (id: string) => data.notebooks.find((n) => n.id === id)?.name ?? "";
  const header =
    view.kind === "all"
      ? { title: "Notes", icon: "note" }
      : view.kind === "shortcuts"
        ? { title: "Shortcuts", icon: "star" }
        : view.kind === "trash"
          ? { title: "Trash", icon: "trash" }
          : view.kind === "tag"
            ? { title: view.tag, icon: "tag" }
            : { title: nbName(view.id), icon: "notebook" };

  // Phone: one screen at a time (list or note); the sidebar slides in as a drawer.
  const showSidebar = compact ? drawerOpen : !focusMode;
  const showList = narrow ? mobilePane === "list" : !focusMode;
  const showEditor = !narrow || mobilePane === "editor";
  const layoutClass = (narrow ? " is-compact is-phone" : medium ? " is-compact is-tablet" : "") + (showRail ? " has-rail" : "");

  return (
    <div className={`app${focusMode && !narrow ? " is-focus" : ""}${layoutClass}`}>
      {compact && drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
      {showRail && !focusMode && (
        <Rail
          view={view}
          onView={(v) => {
            setView(v);
            setSearch("");
          }}
          onMenu={() => setDrawerOpen(true)}
          onSearch={() => {
            setDrawerOpen(true);
            setTimeout(() => searchRef.current?.focus(), 250);
          }}
          onNewNote={createNote}
        />
      )}
      {showSidebar && (
        <Sidebar
          data={data}
          view={view}
          onView={(v) => {
            setView(v);
            setSearch("");
            setDrawerOpen(false);
            setMobilePane("list");
          }}
          search={search}
          onSearch={setSearch}
          onNewNote={createNote}
          onNewNotebook={() => setDialog({ kind: "newNotebook" })}
          onRenameNotebook={(id) => setDialog({ kind: "renameNotebook", id })}
          onDeleteNotebook={(id) => setDialog({ kind: "deleteNotebook", id })}
          allTags={allTags}
          searchRef={searchRef}
          width={compact ? undefined : sbWidth}
          onQuickNote={isTauri ? openQuickNote : undefined}
          sync={syncUi}
        />
      )}
      {!focusMode && !compact && (
        <Resizer label="Resize sidebar" width={sbWidth} min={180} max={420} defaultWidth={SB_DEFAULT} onChange={setSbWidth} />
      )}
      {showList && (
        <NoteList
          width={compact ? undefined : listWidth}
          onMenu={compact && !showRail ? () => setDrawerOpen(true) : undefined}
          onNewNote={compact && !showRail ? createNote : undefined}
          touch={compact}
          onNoteMenu={(id, at) => setNoteMenu({ id, at })}
          sync={
            dbx.connected
              ? { label: syncLabel(syncUi), state: syncStatus?.state ?? "syncing", onSync: () => engineRef.current?.syncNow() }
              : undefined
          }
          listRef={listRef}
          onListKey={onListKey}
          title={search ? `Search results` : header.title}
          icon={search ? "search" : header.icon}
          notes={visibleNotes}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            // Remember it, so folding the phone keeps showing this note.
            setMobilePane("editor");
          }}
          sort={sort}
          onSort={setSort}
          isTrash={view.kind === "trash"}
          onEmptyTrash={() => setDialog({ kind: "emptyTrash" })}
          search={search}
          notebookName={nbName}
          showNotebook={view.kind !== "notebook" && data.notebooks.length > 1}
        />
      )}
      {!focusMode && !compact && (
        <Resizer label="Resize note list" width={listWidth} min={240} max={640} defaultWidth={LIST_DEFAULT} onChange={setListWidth} />
      )}
      {!showEditor ? null : selected ? (
        <EditorPane
          key={`${selected.id}-${quickRev[selected.id] ?? 0}`}
          onBack={narrow ? () => setMobilePane("list") : undefined}
          note={selected}
          notebooks={[...data.notebooks].sort((a, b) => a.name.localeCompare(b.name))}
          allTags={allTags}
          onChange={(patch) => updateNote(selected.id, patch)}
          onTrash={() => {
            const id = selected.id;
            trashNote(id);
            setMobilePane("list");
            setToast({ text: "Note moved to Trash", undo: () => { restoreNote(id); setSelectedId(id); } });
          }}
          onOpenTag={(tag) => {
            setFocusMode(false);
            setSearch("");
            setView({ kind: "tag", tag });
          }}
          onRestore={() => restoreNote(selected.id)}
          onDeleteForever={() => setDialog({ kind: "deleteNote", id: selected.id })}
          onDuplicate={() => duplicateNote(selected.id)}
          focusMode={focusMode}
          onToggleFocus={() => setFocusMode((f) => !f)}
          saveState={saveState}
        />
      ) : (
        <section className="editor-pane editor-empty">
          <Icon name="note" size={56} />
          <p>Select a note or create a new one</p>
          <button className="btn btn-primary" onClick={createNote}>
            <Icon name="plus" size={16} /> New note
          </button>
        </section>
      )}

      {webUpdate && (
        <div className="update-banner" role="status">
          <Icon name="refresh" size={16} />
          <span>A new version of Notewell is ready</span>
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              if (dataRef.current) await saveData(dataRef.current);
              location.reload();
            }}
          >
            Reload
          </button>
          <button className="update-later" onClick={() => setWebUpdate(false)}>Later</button>
        </div>
      )}
      {update && (
        <div className="update-banner" role="status">
          <Icon name="refresh" size={16} />
          <span>
            {installing ? `Installing Notewell ${update.version}…` : `Notewell ${update.version} is available`}
          </span>
          {!installing && (
            <>
              <button className="btn btn-primary btn-sm" onClick={installUpdate}>Restart to update</button>
              <button className="update-later" onClick={() => setUpdate(null)}>Later</button>
            </>
          )}
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo!();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
          <button className="toast-close" title="Dismiss" onClick={() => setToast(null)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {noteMenu &&
        (() => {
          const n = data.notes.find((x) => x.id === noteMenu.id);
          if (!n) return null;
          return (
            <NoteActions
              note={n}
              notebooks={[...data.notebooks].sort((a, b) => a.name.localeCompare(b.name))}
              at={noteMenu.at}
              onClose={() => setNoteMenu(null)}
              onOpen={() => {
                setSelectedId(n.id);
                setMobilePane("editor");
              }}
              onStar={() => updateNote(n.id, { starred: !n.starred, updatedAt: n.updatedAt })}
              onMove={(notebookId) => updateNote(n.id, { notebookId })}
              onDuplicate={() => duplicateNote(n.id)}
              onTrash={() => {
                trashNote(n.id);
                setToast({ text: "Note moved to Trash", undo: () => restoreNote(n.id) });
              }}
              onRestore={() => restoreNote(n.id)}
              onDeleteForever={() => setDialog({ kind: "deleteNote", id: n.id })}
            />
          );
        })()}
      {awaitingCode && pendingCodeSignIn() && (
        <DropboxCodeDialog
          url={pendingCodeSignIn()!.url}
          busy={connecting}
          error={syncError}
          onSubmit={(code) => syncUi.submitCode(code)}
          onCancel={() => {
            cancelCodeSignIn();
            setAwaitingCode(false);
            setSyncError(null);
          }}
        />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      {dialog?.kind === "newNotebook" && (
        <PromptDialog
          title="Create new notebook"
          label="Name"
          placeholder="Notebook name"
          confirmText="Create"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => { setDialog(null); createNotebook(name); }}
        />
      )}
      {dialog?.kind === "renameNotebook" && (
        <PromptDialog
          title="Rename notebook"
          label="Name"
          initial={nbName(dialog.id)}
          confirmText="Rename"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null);
            renameNotebook(dialog.id, name);
          }}
        />
      )}
      {dialog?.kind === "deleteNotebook" &&
        (data.notebooks.length <= 1 ? (
          <ConfirmDialog
            title="Can't delete notebook"
            message="You need at least one notebook. Create another notebook first."
            confirmText="OK"
            onCancel={() => setDialog(null)}
            onConfirm={() => setDialog(null)}
          />
        ) : (
          <ConfirmDialog
            title={`Delete “${nbName(dialog.id)}”?`}
            message="The notes in this notebook will be moved to Trash, where you can still restore them."
            confirmText="Delete notebook"
            onCancel={() => setDialog(null)}
            onConfirm={() => { deleteNotebook(dialog.id); setDialog(null); }}
          />
        ))}
      {dialog?.kind === "deleteNote" && (
        <ConfirmDialog
          title="Delete note permanently?"
          message="This note will be deleted forever. This can't be undone."
          confirmText="Delete permanently"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const id = dialog.id;
            setData((d) => d && removeNotes(d, [id]));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "emptyTrash" && (
        <ConfirmDialog
          title="Empty Trash?"
          message="All notes in Trash will be deleted forever. This can't be undone."
          confirmText="Empty Trash"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setData((d) => d && removeNotes(d, d.notes.filter((n) => n.trashedAt !== null).map((n) => n.id)));
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
