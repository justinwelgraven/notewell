import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { emitTo } from "@tauri-apps/api/event";
import type { Note, Notebook } from "../types";
import { editorExtensions } from "../editor/extensions";
import { sliceToText } from "../editor/clipboardText";
import { focusBodyStart } from "../editor/focus";
import { completedHashtags } from "../editor/Hashtags";
import { getPrefs } from "../lib/prefs";
import { closeThisWindow, isTauri, loadData, onWindowClose } from "../lib/storage";
import { findThumb, uid } from "../lib/util";
import { kbd } from "../lib/keys";
import { Icon } from "./Icon";
import { Dropdown, MenuItem } from "./Menu";

/**
 * The small always-on-top window opened with Ctrl+Alt+N.
 * It never writes the notes file itself: every change is sent to the main window,
 * which owns the data and saves it, so the two windows can't overwrite each other.
 */
export default function QuickNote() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notebookId, setNotebookId] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const idRef = useRef(uid());
  const createdAt = useRef(Date.now());
  const latest = useRef({ title: "", notebookId: "" });
  latest.current = { title, notebookId };
  const timer = useRef<number | undefined>(undefined);
  const sentOnce = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    loadData().then((d) => {
      if (!d) return;
      setNotebooks([...d.notebooks].sort((a, b) => a.name.localeCompare(b.name)));
      setNotebookId((cur) => cur || d.defaultNotebookId);
    });
    titleRef.current?.focus();
  }, []);

  const send = async () => {
    window.clearTimeout(timer.current);
    const editor = editorRef.current;
    if (!editor) return;
    const json = editor.getJSON();
    const note: Note = {
      id: idRef.current,
      title: latest.current.title,
      content: json,
      text: editor.getText({ blockSeparator: "\n" }),
      thumb: findThumb(json),
      notebookId: latest.current.notebookId,
      tags: completedHashtags(editor.state.doc, -1),
      starred: false,
      trashedAt: null,
      createdAt: createdAt.current,
      updatedAt: Date.now(),
    };
    const empty = !note.title.trim() && !note.text.trim() && !note.thumb;
    if (empty && !sentOnce.current) {
      setStatus("");
      return;
    }
    sentOnce.current = true;
    if (isTauri) await emitTo("main", "quick-note", note);
    setStatus(empty ? "" : "Saved to Notewell");
  };

  const schedule = () => {
    setStatus("Saving…");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(send, 400);
  };

  const editor = useEditor({
    extensions: editorExtensions,
    editorProps: {
      attributes: { spellcheck: "true", class: "note-body" },
      clipboardTextSerializer: (slice) => sliceToText(slice, getPrefs().waCopy),
    },
    onUpdate: schedule,
  });
  editorRef.current = editor;

  const closeWindow = async () => {
    await send();
    await closeThisWindow();
  };

  const openInApp = async () => {
    await send();
    if (sentOnce.current && isTauri) await emitTo("main", "quick-note-open", idRef.current);
    await closeWindow();
  };

  // Save whatever is there if the window is closed with the X button.
  useEffect(() => {
    if (!isTauri) return;
    const off = onWindowClose(send);
    return () => {
      off.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // e.g. Ctrl+Enter ticked a checklist item
      if (((e.ctrlKey || e.metaKey) && e.key === "Enter") || (e.key === "Escape" && !document.querySelector(".dropdown-panel"))) {
        e.preventDefault();
        closeWindow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [title]);

  const nb = notebooks.find((n) => n.id === notebookId);

  return (
    <div className="quick">
      {editor && <QuickToolbar editor={editor} />}
      <div className="ep-scroll" onClick={(e) => e.target === e.currentTarget && editor?.chain().focus("end").run()}>
        <div className="ep-doc">
          <textarea
            ref={titleRef}
            className="ep-title"
            placeholder="Title"
            rows={1}
            spellCheck
            value={title}
            onChange={(e) => {
              setTitle(e.target.value.replace(/\n/g, ""));
              schedule();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                focusBodyStart(editor);
              }
            }}
          />
          <EditorContent editor={editor} />
        </div>
      </div>
      <footer className="quick-footer">
        <Dropdown
          trigger={
            <>
              <Icon name="notebook" size={15} />
              <span>{nb?.name ?? "Notebook"}</span>
              <Icon name="chevronDown" size={12} />
            </>
          }
          triggerClassName="ep-notebook"
          title="Save to notebook"
        >
          {(close) => (
            <>
              <div className="menu-heading">Save to</div>
              {notebooks.map((n) => (
                <MenuItem
                  key={n.id}
                  active={n.id === notebookId}
                  onSelect={() => {
                    close();
                    setNotebookId(n.id);
                    latest.current.notebookId = n.id;
                    schedule();
                  }}
                >
                  {n.name}
                </MenuItem>
              ))}
            </>
          )}
        </Dropdown>
        <span className="quick-status">{status}</span>
        <button className="btn btn-secondary btn-sm" onClick={openInApp} title="Open this note in the main window">
          Open in Notewell
        </button>
        <button className="btn btn-primary btn-sm" onClick={closeWindow} title={`Save and close (${kbd("Ctrl+Enter")})`}>
          Done
        </button>
      </footer>
    </div>
  );
}

function QuickToolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      highlight: e.isActive("highlight"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
    }),
  });
  const c = () => editor.chain().focus();
  const btn = (icon: string, title: string, active: boolean, run: () => void) => (
    <button
      key={icon}
      type="button"
      className={`tb-btn${active ? " is-active" : ""}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon name={icon} size={17} />
    </button>
  );
  return (
    <div className="toolbar" role="toolbar">
      {btn("bold", `Bold (${kbd("Ctrl+B")})`, s.bold, () => c().toggleBold().run())}
      {btn("italic", `Italic (${kbd("Ctrl+I")})`, s.italic, () => c().toggleItalic().run())}
      {btn("underline", `Underline (${kbd("Ctrl+U")})`, s.underline, () => c().toggleUnderline().run())}
      {btn("strike", "Strikethrough", s.strike, () => c().toggleStrike().run())}
      {btn("highlight", "Highlight", s.highlight, () => c().toggleHighlight({ color: "#fff1a8" }).run())}
      <span className="tb-sep" />
      {btn("bulletList", "Bulleted list", s.bullet, () => c().toggleBulletList().run())}
      {btn("orderedList", "Numbered list", s.ordered, () => c().toggleOrderedList().run())}
      {btn("checklist", "Checklist", s.task, () => c().toggleTaskList().run())}
    </div>
  );
}
