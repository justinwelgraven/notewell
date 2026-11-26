import { useRef, useState } from "react";
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

export default function NoteList(p: Props) {
  const [imgErrors, setImgErrors] = useState<Record<string, true>>({});
  const sectionRef = useRef<HTMLElement>(null);
  // Swipe in from the left edge opens the sidebar drawer.
  useEdgeSwipe(sectionRef, () => p.onMenu?.(), !!p.touch && !!p.onMenu);
  // Pull the list down to sync with Dropbox.
  const pull = usePullToRefresh(p.listRef, () => p.sync?.onSync(), !!p.touch && !!p.sync);
  const press = useLongPress(p.onNoteMenu);
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
        {p.notes.map((n) => {
          const snippet = n.text.replace(/\s+/g, " ").trim().slice(0, 220);
          const showThumb = n.thumb && !imgErrors[n.id];
          return (
            <article
              key={n.id}
              id={`note-${n.id}`}
              role="option"
              aria-selected={p.selectedId === n.id}
              className={`nl-card${p.selectedId === n.id ? " is-selected" : ""}`}
              {...press.bind(n.id)}
              onClick={() => {
                if (press.consumeClick()) return; // that tap ended a long-press
                p.onSelect(n.id);
                // Keep keyboard focus on the list, so arrows and Delete work right away.
                p.listRef.current?.focus({ preventScroll: true });
              }}
            >
              <div className="nl-card-body">
                <div className="nl-card-title">
                  {n.starred && !p.isTrash && <Icon name="star" size={12} filled className="nl-star" />}
                  {n.title.trim() || "Untitled"}
                </div>
                <div className="nl-card-snippet">{snippet || <span className="nl-muted">No additional text</span>}</div>
                <div className="nl-card-meta">
                  <span>{relativeDate(p.sort === "created" ? n.createdAt : n.updatedAt)}</span>
                  {p.showNotebook && <span className="nl-card-nb">{p.notebookName(n.notebookId)}</span>}
                  {n.tags.slice(0, 2).map((t) => (
                    <span key={t} className="nl-card-tag">{t}</span>
                  ))}
                </div>
              </div>
              {showThumb && (
                <img
                  className="nl-thumb"
                  src={n.thumb!}
                  alt=""
                  onError={() => setImgErrors((e) => ({ ...e, [n.id]: true }))}
                />
              )}
            </article>
          );
        })}
      </div>
      {p.onNewNote && (
        <button className="fab" onClick={p.onNewNote} aria-label="New note">
          <Icon name="plus" size={26} />
        </button>
      )}
    </section>
  );
}
