import { useState } from "react";
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
  return (
    <section className="notelist" style={{ width: p.width }}>
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
                <span>Click <b>+ New</b> to create one</span>
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
              onClick={() => {
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
