import { useEffect } from "react";
import { isMac, kbd, QUICK_NOTE_KEYS } from "../lib/keys";
import { Icon } from "./Icon";

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Notes",
    rows: [
      ["Ctrl+N", "New note"],
      ["QUICK", "Quick note window (from any app)"],
      ["Ctrl+Shift+N", "New notebook"],
      ["Ctrl+F", "Search notes"],
      ["Ctrl+Shift+T", "Add a tag to this note"],
      ["F11", "Focus mode (hide sidebar and list)"],
      ["Ctrl+/", "Show this list"],
    ],
  },
  {
    title: "Note list",
    rows: [
      ["↑ / ↓", "Previous / next note"],
      ["Enter", "Start editing the note"],
      ["Delete / Backspace", "Move note to Trash (Undo appears)"],
      ["Esc", "From the editor: back to the note list"],
    ],
  },
  {
    title: "Formatting",
    rows: [
      ["Ctrl+B", "Bold"],
      ["Ctrl+I", "Italic"],
      ["Ctrl+U", "Underline"],
      ["Ctrl+T", "Strikethrough"],
      ["Ctrl+Shift+H", "Highlight"],
      ["Ctrl+E", "Inline code"],
      ["Ctrl+K", "Add / edit link"],
      ["Ctrl+\\", "Clear formatting"],
      ["Ctrl+Alt+1 / 2 / 3", "Large / medium / small header"],
      ["Ctrl+Alt+0", "Normal text"],
    ],
  },
  {
    title: "Lists & blocks",
    rows: [
      ["Ctrl+Shift+B", "Bulleted list"],
      ["Ctrl+Shift+O", "Numbered list"],
      ["Ctrl+Shift+C", "Checklist"],
      ["Tab / Shift+Tab", "Indent / outdent list item"],
      ["Ctrl+Enter", "Tick / untick checklist item"],
      ["Ctrl+Shift+Q", "Quote"],
      ["Ctrl+Shift+L", "Code block"],
      ["Ctrl+Shift+-", "Divider"],
    ],
  },
  {
    title: "While typing",
    rows: [
      ["#word", "Adds the tag “word” (Ctrl+click it to see all notes with that tag)"],
      ["- or *  then space", "Bulleted list"],
      ["1.  then space", "Numbered list"],
      ["[ ]  then space", "Checklist"],
      ["#  then space", "Header (## and ### for smaller)"],
      [">  then space", "Quote"],
      ["```", "Code block"],
      ["Paste a link", "Preview card, or player for YouTube / Spotify"],
      ["Ctrl+Shift+V", "Paste as plain text"],
    ],
  },
];

function label(combo: string): string {
  if (combo === "QUICK") return QUICK_NOTE_KEYS;
  if (!isMac || !/Ctrl|Alt|Shift/.test(combo)) return combo;
  return combo
    .split(" / ")
    .map((part) => (/^(Ctrl|Alt|Shift)(\+|$)/.test(part) ? kbd(part) : part))
    .join(" / ");
}

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shortcuts-modal" role="dialog" aria-label="Keyboard shortcuts">
        <div className="shortcuts-head">
          <h2>Keyboard shortcuts</h2>
          <button className="ep-icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="shortcuts-grid">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <dl>
                {s.rows.map(([keys, what]) => (
                  <div key={keys + what} className="shortcut-row">
                    <dt>
                      <kbd>{label(keys)}</kbd>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
