import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { getText, getTextSerializersFromSchema } from "@tiptap/core";
import { DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { Note, Notebook } from "../types";
import { editorExtensions, noteBodyAttributes } from "../editor/extensions";
import { nativeSpellcheck } from "../editor/NativeSpell";
import { insertUrlBlock } from "../editor/SmartPaste";
import { isUrl } from "../lib/embeds";
import { findThumb, fullDate, relativeDate } from "../lib/util";
import { openExternal } from "../lib/storage";
import { sliceToText } from "../editor/clipboardText";
import { focusBodyStart } from "../editor/focus";
import { getPrefs } from "../lib/prefs";
import { completedHashtags, mergeTags } from "../editor/Hashtags";
import Toolbar from "./Toolbar";
import MarginControl from "./MarginControl";
import KeyboardBar from "./KeyboardBar";
import { useEdgeSwipe } from "../lib/gestures";
import { imageFiles } from "../lib/images";
import { insertImages } from "../editor/NoteImage";
import { setSearchHighlight } from "../editor/SearchHighlight";
import { Icon } from "./Icon";
import { Dropdown, MenuItem, PromptDialog } from "./Menu";

interface Props {
  note: Note;
  notebooks: Notebook[];
  allTags: string[];
  onChange: (patch: Partial<Note>) => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onDuplicate: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  saveState: "saved" | "saving" | "error";
  onOpenTag: (tag: string) => void;
  /** Phone: back to the note list. */
  onBack?: () => void;
  /** Bumped when the note was changed outside this editor; the editor then shows the new version. */
  rev: number;
  /** Current search words, highlighted in the note. */
  search?: string;
  onTogglePin: () => void;
  onToggleStar: () => void;
  /** Dropbox connected: earlier versions can be restored. */
  onHistory?: () => void;
  /** Notes that link to this one ([[…]]). */
  backlinks: { id: string; title: string }[];
  onOpenNote: (id: string) => void;
}

export default function EditorPane(p: Props) {
  const { note } = p;
  const trashed = note.trashedAt !== null;
  const onChangeRef = useRef(p.onChange);
  onChangeRef.current = p.onChange;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [dialog, setDialog] = useState<null | "link" | "url">(null);
  // Phone: swipe in from the left edge to go back to the list.
  const paneRef = useRef<HTMLElement>(null);
  useEdgeSwipe(paneRef, () => p.onBack?.(), !!p.onBack && !dialog, true);
  const tagsRef = useRef(note.tags);
  tagsRef.current = note.tags;
  const tagInputRef = useRef<HTMLInputElement>(null);

  /** Adds finished #hashtags to the note's tags. */
  const tagsFromHashtags = (ed: { state: { doc: any; selection: { empty: boolean; from: number } } }, atBlur = false) => {
    const cursor = atBlur || !ed.state.selection.empty ? -1 : ed.state.selection.from;
    return mergeTags(tagsRef.current, completedHashtags(ed.state.doc, cursor));
  };

  const editor = useEditor({
    extensions: editorExtensions,
    content: note.content ?? "",
    editable: !trashed,
    editorProps: {
      attributes: noteBodyAttributes,
      clipboardTextSerializer: (slice) => sliceToText(slice, getPrefs().waCopy),
      handleDOMEvents: {
        // After Ctrl/⌘+A, copy and cut include the title (in bold) — see copyWithTitle.
        copy: (view, e) => copyWithTitle(view, e, false),
        cut: (view, e) => copyWithTitle(view, e, true),
        blur: () => {
          setAllSelected(false);
          return false;
        },
      },
      handleKeyDown: (_view, e) => {
        // Ctrl/⌘+A: select the whole note, title included.
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
          e.preventDefault();
          selectWholeNote();
          return true;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          setDialog("link");
          return true;
        }
        // Esc hands focus back to the note list (then arrows / Delete work there).
        if (e.key === "Escape" && !document.querySelector(".dropdown-panel, .modal")) {
          window.dispatchEvent(new Event("notewell:focus-list"));
          return true;
        }
        return false;
      },
    },
    // Typing: the note's data (body, list text, thumbnail, #tags) is worked out at most every 250 ms
    // instead of on every keystroke — that keeps typing smooth on iPhone with long notes.
    onUpdate: ({ editor }) => {
      // Keep the latest document (immutable, so this is free); it's still readable after the editor closes.
      dirty.current = { doc: editor.state.doc, selection: editor.state.selection };
      window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(flush, 250);
    },
    // A hashtag typed at the very end, then clicking away, still becomes a tag.
    onBlur: ({ editor }) => {
      flush();
      const tags = tagsFromHashtags(editor, true);
      if (tags) onChangeRef.current({ tags });
    },
  });

  // ---- Select all (Ctrl/⌘+A) includes the title ----
  // The title is its own field, so it can't be part of the text selection itself: it's shown as
  // selected, and copy / cut put "title + text" on the clipboard, with the title in bold
  // (*Title* for WhatsApp-style copying, <strong> for apps that paste formatted text).
  const [allSelected, setAllSelected] = useState(false);
  const allSelectedRef = useRef(false);
  allSelectedRef.current = allSelected;
  function selectWholeNote() {
    const ed = editorInstance.current;
    if (!ed) return;
    ed.chain().focus().selectAll().run();
    setAllSelected(true);
  }
  function copyWithTitle(view: EditorView, e: ClipboardEvent, cut: boolean): boolean {
    const { from, to } = view.state.selection;
    const whole = from <= 1 && to >= view.state.doc.content.size - 1;
    if (!allSelectedRef.current || !whole || !e.clipboardData) return false;
    const title = (titleRef.current?.value ?? "").trim();
    const wa = getPrefs().waCopy;
    const bodyText = sliceToText(view.state.doc.slice(0, view.state.doc.content.size), wa);
    const box = document.createElement("div");
    box.appendChild(DOMSerializer.fromSchema(view.state.schema).serializeFragment(view.state.doc.content));
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    e.preventDefault();
    e.clipboardData.setData("text/plain", title ? `${wa ? `*${title}*` : title}\n\n${bodyText}` : bodyText);
    e.clipboardData.setData("text/html", (title ? `<p><strong>${esc(title)}</strong></p>` : "") + box.innerHTML);
    if (cut && view.editable) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
    return true;
  }
  const editorInstance = useRef<ReturnType<typeof useEditor>>(null);
  editorInstance.current = editor;
  // Any other selection (click, arrow keys, typing) ends "whole note selected".
  useEffect(() => {
    if (!editor) return;
    const check = () => {
      const { from, to } = editor.state.selection;
      if (allSelectedRef.current && !(from <= 1 && to >= editor.state.doc.content.size - 1)) setAllSelected(false);
    };
    editor.on("selectionUpdate", check);
    editor.on("update", check);
    return () => {
      editor.off("selectionUpdate", check);
      editor.off("update", check);
    };
  }, [editor]);

  const dirty = useRef<{ doc: PMNode; selection: { empty: boolean; from: number } } | null>(null);
  const flushTimer = useRef<number | undefined>(undefined);
  function flush() {
    window.clearTimeout(flushTimer.current);
    const pending = dirty.current;
    if (!pending) return;
    dirty.current = null;
    const { doc } = pending;
    const json = doc.toJSON();
    const tags = tagsFromHashtags({ state: pending });
    onChangeRef.current({
      content: json,
      text: getText(doc, { blockSeparator: "\n", textSerializers: getTextSerializersFromSchema(doc.type.schema) }),
      thumb: findThumb(json),
      ...(tags ? { tags } : {}),
    });
  }
  // Never lose the last keystrokes: save when switching notes, hiding the app or closing.
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    window.addEventListener("notewell:flush-editor", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("notewell:flush-editor", flush);
      flush();
    };
  }, []);

  // The note was changed elsewhere (another device, quick note window, restored version): show the new
  // version in place, keeping the cursor and the keyboard, instead of reloading the editor.
  const firstRev = useRef(true);
  useEffect(() => {
    if (firstRev.current) {
      firstRev.current = false;
      return;
    }
    if (!editor || editor.isDestroyed) return;
    // Typed something that wasn't handed over yet: keep what's typed here (it uploads over the other
    // version, which stays available in Version history).
    if (dirty.current) return flush();
    const { from, to } = editor.state.selection;
    editor.commands.setContent(note.content ?? "", { emitUpdate: false });
    const max = editor.state.doc.content.size;
    try {
      editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
    } catch {}
  }, [p.rev]);

  // Search words are highlighted in the note; when opening a note from search, jump to the first one.
  const searchedOnce = useRef(false);
  useEffect(() => {
    if (!editor) return;
    setSearchHighlight(editor, p.search ?? "", !searchedOnce.current);
    searchedOnce.current = true;
  }, [editor, p.search]);

  const imageInput = useRef<HTMLInputElement>(null);
  const pickImages = () => imageInput.current?.click();

  // Fill in the snippet for notes that have never been edited (e.g. the welcome note).
  useEffect(() => {
    if (editor && !note.text && !editor.isEmpty) {
      onChangeRef.current({ text: editor.getText({ blockSeparator: "\n" }), updatedAt: note.updatedAt });
    }
  }, [editor]);

  // New, empty notes start with the cursor in the title.
  useEffect(() => {
    if (!trashed && !note.title && editor?.isEmpty) titleRef.current?.focus();
  }, []);

  // Grow the title box with its content.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [note.title]);

  // Enter in the note list focuses the editor; Ctrl+Shift+T focuses the tag field.
  useEffect(() => {
    const toEditor = () => {
      if (!note.title && titleRef.current) titleRef.current.focus();
      else editor?.commands.focus("end");
    };
    const toTags = () => tagInputRef.current?.focus();
    window.addEventListener("notewell:focus-editor", toEditor);
    window.addEventListener("notewell:focus-tags", toTags);
    return () => {
      window.removeEventListener("notewell:focus-editor", toEditor);
      window.removeEventListener("notewell:focus-tags", toTags);
    };
  }, [editor, note.title]);

  const handleBodyClick = (e: React.MouseEvent) => {
    const tagEl = (e.target as HTMLElement).closest(".note-body .hashtag") as HTMLElement | null;
    if (tagEl && (e.ctrlKey || e.metaKey || trashed)) {
      e.preventDefault();
      const tag = tagEl.dataset.tag ?? "";
      const existing = note.tags.find((t) => t.toLowerCase() === tag.toLowerCase());
      p.onOpenTag(existing ?? tag);
      return;
    }
    const a = (e.target as HTMLElement).closest(".note-body a[href]") as HTMLAnchorElement | null;
    if (a && (e.ctrlKey || e.metaKey || trashed)) {
      e.preventDefault();
      openExternal(a.href);
      return;
    }
  };

  /**
   * A click anywhere on the note page puts the cursor in the text, like Evernote: in the margins it
   * goes to the nearest spot on that line, below the text to the end. (Before, only clicks right on
   * the text worked — clicking beside it gave no cursor, so it took several tries.)
   */
  const handlePageMouseDown = (e: React.MouseEvent) => {
    if (!editor || trashed || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".ProseMirror, .ep-title, button, a, input, textarea, .backlinks, .node-actions")) return;
    const rect = editor.view.dom.getBoundingClientRect();
    e.preventDefault();
    // Beside the title: into the title.
    const title = titleRef.current?.getBoundingClientRect();
    if (title && e.clientY >= title.top && e.clientY <= title.bottom && titleRef.current) {
      titleRef.current.focus();
      const end = titleRef.current.value.length;
      titleRef.current.setSelectionRange(end, end);
      return;
    }
    // Focus right away (the editor's own focus command waits a frame, which could lose the click).
    const place = (pos: number) => {
      editor.view.focus();
      editor.commands.setTextSelection(pos);
    };
    const end = () => {
      editor.view.focus();
      editor.commands.focus("end");
    };
    if (e.clientY > rect.bottom) return end();
    const left = Math.min(Math.max(e.clientX, rect.left + 2), rect.right - 2);
    const top = Math.min(Math.max(e.clientY, rect.top + 2), rect.bottom - 2);
    const at = editor.view.posAtCoords({ left, top });
    if (at) place(at.pos);
    else end();
  };

  const currentLink = editor?.getAttributes("link").href as string | undefined;
  const notebook = p.notebooks.find((n) => n.id === note.notebookId);

  const [tagDraft, setTagDraft] = useState("");
  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,$/, "").trim();
    if (!t || note.tags.includes(t)) return setTagDraft("");
    p.onChange({ tags: [...note.tags, t] });
    setTagDraft("");
  };

  return (
    <section className="editor-pane" ref={paneRef}>
      <div className="ep-topbar">
        <div className="ep-topbar-left">
          {p.onBack ? (
            <button className="ep-back" onClick={p.onBack} aria-label="Back to notes">
              <Icon name="chevronLeft" size={22} />
              <span>Notes</span>
            </button>
          ) : (
            <button className="ep-icon-btn" title={p.focusMode ? "Exit focus mode" : "Expand note"} onClick={p.onToggleFocus}>
              <Icon name={p.focusMode ? "collapse" : "expand"} size={16} />
            </button>
          )}
          <Dropdown
            trigger={
              <>
                <Icon name="notebook" size={15} />
                <span>{notebook?.name ?? "Notebook"}</span>
                <Icon name="chevronDown" size={12} />
              </>
            }
            triggerClassName="ep-notebook"
            title="Move to notebook"
            disabled={trashed}
          >
            {(close) => (
              <>
                <div className="menu-heading">Move to</div>
                {p.notebooks.map((nb) => (
                  <MenuItem
                    key={nb.id}
                    active={nb.id === note.notebookId}
                    onSelect={() => { close(); p.onChange({ notebookId: nb.id }); }}
                  >
                    {nb.name}
                  </MenuItem>
                ))}
              </>
            )}
          </Dropdown>
        </div>
        <div className="ep-topbar-right">
          <span className={`ep-save ep-save-${p.saveState}`}>
            {p.saveState === "saving" ? "Saving…" : p.saveState === "error" ? "Couldn't save" : "All changes saved"}
          </span>
          <MarginControl />
          {!trashed && (
            <button
              className={`ep-icon-btn${note.starred ? " is-starred" : ""}`}
              title={note.starred ? "Remove from Shortcuts" : "Add to Shortcuts"}
              onClick={p.onToggleStar}
            >
              <Icon name="star" size={17} filled={note.starred} />
            </button>
          )}
          <Dropdown trigger={<Icon name="more" size={18} />} triggerClassName="ep-icon-btn" align="right" title="More actions">
            {(close) =>
              trashed ? (
                <>
                  <MenuItem onSelect={() => { close(); p.onRestore(); }}>Restore note</MenuItem>
                  <MenuItem danger onSelect={() => { close(); p.onDeleteForever(); }}>Delete permanently</MenuItem>
                </>
              ) : (
                <>
                  <MenuItem onSelect={() => { close(); p.onToggleStar(); }}>
                    {note.starred ? "Remove from Shortcuts" : "Add to Shortcuts"}
                  </MenuItem>
                  <MenuItem onSelect={() => { close(); p.onTogglePin(); }}>
                    {note.pinned ? "Unpin from top" : "Pin to top of list"}
                  </MenuItem>
                  <MenuItem onSelect={() => { close(); p.onDuplicate(); }}>Duplicate</MenuItem>
                  {p.onHistory && (
                    <MenuItem onSelect={() => { close(); flush(); p.onHistory!(); }}>Version history…</MenuItem>
                  )}
                  <div className="menu-sep" />
                  <div className="menu-info">
                    Created {fullDate(note.createdAt)}
                    <br />
                    Updated {fullDate(note.updatedAt)}
                  </div>
                  <div className="menu-sep" />
                  <MenuItem danger onSelect={() => { close(); p.onTrash(); }}>Move to Trash</MenuItem>
                </>
              )
            }
          </Dropdown>
        </div>
      </div>

      {trashed ? (
        <div className="ep-trash-banner">
          <Icon name="trash" size={16} />
          <span>This note is in Trash.</span>
          <button className="btn btn-secondary btn-sm" onClick={p.onRestore}>
            <Icon name="restore" size={14} /> Restore
          </button>
          <button className="btn btn-danger btn-sm" onClick={p.onDeleteForever}>Delete permanently</button>
        </div>
      ) : (
        editor && <Toolbar editor={editor} onLink={() => setDialog("link")} onInsertUrl={() => setDialog("url")} onInsertImage={pickImages} />
      )}
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = imageFiles(e.target.files);
          e.target.value = "";
          if (editor && files.length) void insertImages(editor, files);
        }}
      />

      <div className="ep-scroll" onClick={handleBodyClick} onMouseDown={handlePageMouseDown}>
        <div className="ep-doc">
          <textarea
            ref={titleRef}
            className={`ep-title${allSelected ? " is-all-selected" : ""}`}
            placeholder="Title"
            value={note.title}
            rows={1}
            spellCheck={!nativeSpellcheck} /* Windows: English-only browser check off; titles are short */
            readOnly={trashed}
            onChange={(e) => p.onChange({ title: e.target.value.replace(/\n/g, "") })}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                window.dispatchEvent(new Event("notewell:focus-list"));
                return;
              }
              // Ctrl/⌘+A in the title also selects the whole note (title + text).
              if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
                e.preventDefault();
                selectWholeNote();
                return;
              }
              if (e.key === "Enter" || (e.key === "ArrowDown" && !e.shiftKey)) {
                e.preventDefault();
                focusBodyStart(editor);
              }
            }}
          />
          <EditorContent editor={editor} />
          {p.backlinks.length > 0 && (
            <div className="backlinks">
              <span className="backlinks-label">
                <Icon name="link" size={13} /> Linked from
              </span>
              {p.backlinks.map((b) => (
                <button key={b.id} className="note-link" onClick={() => p.onOpenNote(b.id)}>
                  {b.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {editor && !trashed && <KeyboardBar editor={editor} onInsertImage={pickImages} />}
      <footer className="ep-footer">
        <div className="ep-tags">
          <Icon name="tag" size={15} />
          {note.tags.map((t) => (
            <span key={t} className="tag-chip">
              {t}
              {!trashed && (
                <button title={`Remove tag ${t}`} onClick={() => p.onChange({ tags: note.tags.filter((x) => x !== t) })}>
                  <Icon name="x" size={11} />
                </button>
              )}
            </span>
          ))}
          {!trashed && (
            <>
              <input
                ref={tagInputRef}
                className="tag-input"
                placeholder={note.tags.length ? "" : "Add tag"}
                value={tagDraft}
                list="tag-suggestions"
                onChange={(e) => (e.target.value.endsWith(",") ? addTag(e.target.value) : setTagDraft(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTag(tagDraft);
                  if (e.key === "Backspace" && !tagDraft && note.tags.length) p.onChange({ tags: note.tags.slice(0, -1) });
                }}
                onBlur={() => tagDraft && addTag(tagDraft)}
              />
              <datalist id="tag-suggestions">
                {p.allTags.filter((t) => !note.tags.includes(t)).map((t) => <option key={t} value={t} />)}
              </datalist>
            </>
          )}
        </div>
        <span className="ep-edited" title={fullDate(note.updatedAt)}>Edited {relativeDate(note.updatedAt).toLowerCase()}</span>
      </footer>

      {dialog === "link" && editor && (
        <PromptDialog
          title={currentLink ? "Edit link" : "Add link"}
          label="URL"
          placeholder="https://example.com"
          initial={currentLink ?? ""}
          confirmText="Apply"
          onCancel={() => { setDialog(null); editor.commands.focus(); }}
          onConfirm={(raw) => {
            setDialog(null);
            const href = /^[a-z]+:/i.test(raw) ? raw : `https://${raw}`;
            const { empty } = editor.state.selection;
            if (empty && !editor.isActive("link")) {
              editor.chain().focus().insertContent({ type: "text", text: raw, marks: [{ type: "link", attrs: { href } }] }).run();
            } else {
              editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
            }
          }}
        />
      )}
      {dialog === "url" && editor && (
        <PromptDialog
          title="Insert link preview or player"
          label="Paste a website, YouTube or Spotify link"
          placeholder="https://"
          confirmText="Insert"
          onCancel={() => { setDialog(null); editor.commands.focus(); }}
          onConfirm={(raw) => {
            setDialog(null);
            const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
            if (isUrl(url)) insertUrlBlock(editor, url);
          }}
        />
      )}
    </section>
  );
}
