import { useEffect, useState } from "react";
import type { Note } from "../types";
import { noteVersion, noteVersions } from "../sync/engine";
import { docText, fullDate } from "../lib/util";
import { Icon } from "./Icon";

/** Earlier versions of a note, as kept by Dropbox; pick one to see it and restore it. */
export default function HistoryDialog({ noteId, onClose, onRestore }: { noteId: string; onClose: () => void; onRestore: (n: Note) => void }) {
  const [versions, setVersions] = useState<{ rev: string; at: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<Note | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    noteVersions(noteId)
      .then(setVersions)
      .catch((e) => setError(/not_found/.test(String(e)) ? "This note hasn't been synced to Dropbox yet." : `Couldn't load versions: ${String(e).slice(0, 120)}`));
  }, [noteId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (rev: string) => {
    setPicked(rev);
    setPreview(null);
    setLoading(true);
    noteVersion(rev)
      .then(setPreview)
      .catch((e) => setError(String(e).slice(0, 160)))
      .finally(() => setLoading(false));
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal history-modal" role="dialog" aria-label="Version history">
        <div className="history-head">
          <h2 className="modal-title">Version history</h2>
          <button className="toast-close" title="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        {error && <p className="dbx-err">{error}</p>}
        {!error && !versions && <p className="history-muted">Loading versions…</p>}
        {versions && (
          <div className="history-body">
            <div className="history-list">
              {versions.map((v, i) => (
                <button key={v.rev} className={`history-item${picked === v.rev ? " is-active" : ""}`} onClick={() => pick(v.rev)}>
                  {fullDate(new Date(v.at).getTime())}
                  {i === 0 && <small>Current</small>}
                </button>
              ))}
            </div>
            <div className="history-preview">
              {!picked && <p className="history-muted">Pick a version to see it.</p>}
              {loading && <p className="history-muted">Loading…</p>}
              {preview && (
                <>
                  <h3>{preview.title.trim() || "Untitled"}</h3>
                  <pre>{docText(preview.content).slice(0, 4000) || "(empty)"}</pre>
                </>
              )}
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={!preview} onClick={() => preview && onRestore(preview)}>
            <Icon name="restore" size={15} /> Restore this version
          </button>
        </div>
      </div>
    </div>
  );
}
