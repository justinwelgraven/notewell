import { useEffect, useState } from "react";
import type { Note, Notebook } from "../types";
import { Icon } from "./Icon";

interface Props {
  note: Note;
  notebooks: Notebook[];
  /** Where a mouse right-click happened (desktop). Null on touch: shows a bottom sheet. */
  at: { x: number; y: number } | null;
  onClose: () => void;
  onOpen: () => void;
  onStar: () => void;
  onMove: (notebookId: string) => void;
  onDuplicate: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
}

/** Actions for one note: long-press on touch screens (bottom sheet), right-click with a mouse (menu at pointer). */
export default function NoteActions(p: Props) {
  const [moving, setMoving] = useState(false);
  const trashed = p.note.trashedAt !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);

  const act = (fn: () => void) => () => {
    fn();
    p.onClose();
  };
  const row = (icon: string, label: string, onClick: () => void, cls = "") => (
    <button className={`sheet-item ${cls}`} onClick={onClick}>
      <Icon name={icon} size={19} />
      <span>{label}</span>
    </button>
  );

  // Keep a pointer menu inside the window.
  const style = p.at
    ? { left: Math.min(p.at.x, window.innerWidth - 260), top: Math.min(p.at.y, window.innerHeight - (moving ? 320 : 280)) }
    : undefined;

  return (
    <div className={`sheet-backdrop${p.at ? " is-popover" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className={p.at ? "sheet sheet-popover" : "sheet"} style={style} role="menu" aria-label={`Actions for ${p.note.title || "Untitled"}`}>
        {!p.at && <div className="sheet-grip" />}
        <div className="sheet-title">{p.note.title.trim() || "Untitled"}</div>
        {moving ? (
          <>
            {row("chevronLeft", "Back", () => setMoving(false), "is-muted")}
            {p.notebooks.map((nb) => (
              <button key={nb.id} className="sheet-item" onClick={act(() => p.onMove(nb.id))}>
                <Icon name="notebook" size={19} />
                <span>{nb.name}</span>
                {nb.id === p.note.notebookId && <Icon name="check" size={16} className="sheet-check" />}
              </button>
            ))}
          </>
        ) : trashed ? (
          <>
            {row("restore", "Restore", act(p.onRestore))}
            {row("trash", "Delete permanently…", act(p.onDeleteForever), "is-danger")}
          </>
        ) : (
          <>
            {!p.at && row("note", "Open", act(p.onOpen))}
            {row("star", p.note.starred ? "Remove from Shortcuts" : "Add to Shortcuts", act(p.onStar))}
            {row("notebook", "Move to notebook…", () => setMoving(true))}
            {row("copy", "Duplicate", act(p.onDuplicate))}
            {row("trash", "Move to Trash", act(p.onTrash), "is-danger")}
          </>
        )}
        {!p.at && (
          <button className="sheet-cancel" onClick={p.onClose}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
