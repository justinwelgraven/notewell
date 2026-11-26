import { memo, useCallback, useEffect, useRef, useState } from "react";
import { IMAGE_THUMB_PREFIX, loadImage } from "../lib/images";
import { PULL_TRIGGER, useEdgeSwipe, useLongPress, usePullToRefresh } from "../lib/gestures";
import type { Note, SortMode } from "../types";
import { relativeDate } from "../lib/util";
import { Icon } from "./Icon";
import { Dropdown, MenuItem } from "./Menu";

interface Props {
  title: string;
  icon: string;
  notes: Note[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  sort: SortMode;
  onSort: (s: SortMode) => void;
  isTrash: boolean;
  onEmptyTrash: () => void;
  search: string;
  notebookName: (id: string) => string;
  showNotebook: boolean;
  width?: number;
  /** Phone: opens the sidebar drawer. */
  onMenu?: () => void;
  /** Phone: floating "new note" button. */
  onNewNote?: () => void;
  /** Long-press (touch) or right-click on a note. */
  onNoteMenu: (id: string, at: { x: number; y: number } | null) => void;
  /** Phone/unfolded: pull down to sync, and the sync status line. Undefined when not connected. */
  sync?: { label: string; state: string; onSync: () => void };
  /** Phone/unfolded layout: enables touch gestures. */
  touch?: boolean;
  onListKey: (e: React.KeyboardEvent) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
}

const SORT_LABELS: Record<SortMode, string> = {
  updated: "Date updated",
  created: "Date created",
  title: "Title",
};

/** Text with the search words marked. */
function Marked({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(query); i !== -1; i = lower.indexOf(query, i + query.length)) {
    if (i > at) parts.push(text.slice(at, i));
    parts.push(<mark key={i} className="search-hit">{text.slice(i, i + query.length)}</mark>);
    at = i + query.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/** List snippet; while searching, starts near the first match so it's visible. */
function snippetOf(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const i = query ? flat.toLowerCase().indexOf(query) : -1;
  if (i > 60) return "…" + flat.slice(i - 40, i + 180);
  return flat.slice(0, 220);
}

/** Note-list thumbnail: a web image, or a picture stored in the note ("nwimg:<id>"). */
function Thumb({ src }: { src: string }) {
  const [url, setUrl] = useState<string | null>(src.startsWith(IMAGE_THUMB_PREFIX) ? null : src);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!src.startsWith(IMAGE_THUMB_PREFIX)) return setUrl(src);
    let live = true;
    loadImage(src.slice(IMAGE_THUMB_PREFIX.length))
      .then((d) => live && setUrl(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [src]);
  if (!url || failed) return null;
  return <img className="nl-thumb" src={url} alt="" onError={() => setFailed(true)} />;
}

interface CardProps {
  note: Note;
  selected: boolean;
  isTrash: boolean;
  date: number;
  notebook: string | null;
  query: string;
  press: ReturnType<typeof useLongPress>;
  onPick: (id: string) => void;
}

/** One note in the list. Memoized: typing in a note only redraws that note's card. */
const NoteCard = memo(function NoteCard({ note: n, selected, isTrash, date, notebook, query, press, onPick }: CardProps) {
  const snippet = snippetOf(n.text, query);
  return (
    <article
      id={`note-${n.id}`}
      role="option"
      aria-selected={selected}
      className={`nl-card${selected ? " is-selected" : ""}${n.pinned && !isTrash ? " is-pinned" : ""}`}
      {...press.bind(n.id)}
      onClick={() => {
        if (press.consumeClick()) return; // that tap ended a long-press
        onPick(n.id);
      }}
    >
      <div className="nl-card-body">
        <div className="nl-card-title">
          {n.pinned && !isTrash && <Icon name="pin" size={12} className="nl-pin" />}
          {n.starred && !isTrash && <Icon name="star" size={12} filled className="nl-star" />}
          <span className="nl-card-title-text"><Marked text={n.title.trim() || "Untitled"} query={query} /></span>
        </div>
        <div className="nl-card-snippet">{snippet ? <Marked text={snippet} query={query} /> : <span className="nl-muted">No additional text</span>}</div>
        <div className="nl-card-meta">
          <span>{relativeDate(date)}</span>
          {notebook && <span className="nl-card-nb">{notebook}</span>}
          {n.tags.slice(0, 2).map((t) => (
            <span key={t} className="nl-card-tag">{t}</span>
          ))}
        </div>
      </div>
      {n.thumb && <Thumb src={n.thumb} />}
    </article>
  );
});

export default function NoteList(p: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  // Stable callbacks, so the memoized cards don't all redraw on every change.
  const latest = useRef(p);
  latest.current = p;
  const pick = useCallback((id: string) => {
    latest.current.onSelect(id);
    // Keep keyboard focus on the list, so arrows and Delete work right away.
    latest.current.listRef.current?.focus({ preventScroll: true });
  }, []);
  const onNoteMenu = useCallback((id: string, at: { x: number; y: number } | null) => latest.current.onNoteMenu(id, at), []);
  // Swipe in from the left edge opens the sidebar drawer.
  useEdgeSwipe(sectionRef, () => p.onMenu?.(), !!p.touch && !!p.onMenu);
  // Pull the list down to sync with Dropbox.
  const pull = usePullToRefresh(p.listRef, () => p.sync?.onSync(), !!p.touch && !!p.sync);
  const press = useLongPress(onNoteMenu);
  return (
    <section className="notelist" style={{ width: p.width }} ref={sectionRef}>
      <header className="nl-header">
        <div className="nl-title">
          {p.onMenu && (
            <button className="nl-menu" onClick={p.onMenu} title="Menu" aria-label="Open menu">
              <Icon name="menu" size={22} />
            </button>
          )}
          <Icon name={p.icon} size={22} />
          <h1>{p.title}</h1>
        </div>
        <div className="nl-subbar">
          <span className="nl-count">
            {p.notes.length} {p.notes.length === 1 ? "note" : "notes"}
            {p.touch && p.sync && (
              <button className={`nl-sync nl-sync-${p.sync.state}`} onClick={p.sync.onSync} title="Sync now">
                <Icon name={p.sync.state === "offline" || p.sync.state === "error" ? "cloudOff" : "cloud"} size={13} />
                {p.sync.label}
              </button>
            )}
          </span>
          <div className="nl-tools">
            {p.isTrash && p.notes.length > 0 && (
              <button className="nl-empty-trash" onClick={p.onEmptyTrash}>Empty Trash</button>
            )}
            <Dropdown trigger={<Icon name="sort" size={16} />} triggerClassName="nl-tool" align="right" title="Sort options">
              {(close) => (
                <>
                  <div className="menu-heading">Sort by</div>
                  {(Object.keys(SORT_LABELS) as SortMode[]).map((s) => (
                    <MenuItem key={s} active={p.sort === s} onSelect={() => { p.onSort(s); close(); }}>
                      {p.sort === s && <Icon name="check" size={14} />} {SORT_LABELS[s]}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
          </div>
        </div>
        {p.isTrash && p.notes.length > 0 && <div className="nl-trash-note">Notes in Trash are deleted after 30 days</div>}
      </header>

      <div
        className="nl-items"
        ref={p.listRef}
        tabIndex={0}
        role="listbox"
        aria-label="Notes"
        aria-activedescendant={p.selectedId ? `note-${p.selectedId}` : undefined}
        onKeyDown={p.onListKey}
      >
        {p.touch && p.sync && (
          <div className="nl-pull" style={{ height: pull, opacity: Math.min(1, pull / PULL_TRIGGER) }} aria-hidden="true">
            <Icon name="refresh" size={16} />
            <span>{pull >= PULL_TRIGGER ? "Release to sync" : "Pull to sync"}</span>
          </div>
        )}
        {p.notes.length === 0 && (
          <div className="nl-empty">
            {p.search ? (
              <>
                <Icon name="search" size={40} />
                <p>No notes match “{p.search}”</p>
              </>
            ) : p.isTrash ? (
              <>
                <Icon name="trash" size={40} />
                <p>Trash is empty</p>
              </>
            ) : (
              <>
                <Icon name="note" size={40} />
                <p>No notes here yet</p>
                <span>{p.touch ? <>Tap <b>+</b> to create one</> : <>Click <b>+ New</b> to create one</>}</span>
              </>
            )}
          </div>
        )}
        {p.notes.map((n) => (
          <NoteCard
            key={n.id}
            note={n}
            selected={p.selectedId === n.id}
            isTrash={p.isTrash}
            date={p.sort === "created" ? n.createdAt : n.updatedAt}
            notebook={p.showNotebook ? p.notebookName(n.notebookId) : null}
            query={p.search.trim().toLowerCase()}
            press={press}
            onPick={pick}
          />
        ))}
      </div>
      {p.onNewNote && (
        <button className="fab" onClick={p.onNewNote} aria-label="New note">
          <Icon name="plus" size={26} />
        </button>
      )}
    </section>
  );
}
