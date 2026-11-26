import { useEditorState, type Editor } from "@tiptap/react";
import { Icon } from "./Icon";

/**
 * Phone / iPhone Duo: a formatting bar that sits right above the on-screen keyboard while typing
 * (like Apple Notes), so it's within thumb reach. Only shown while the keyboard is open (see styles.css).
 */
export default function KeyboardBar({ editor, onInsertImage }: { editor: Editor; onInsertImage: () => void }) {
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
      inList: e.isActive("listItem") || e.isActive("taskItem"),
      canUndo: e.can().undo(),
    }),
  });
  const c = () => editor.chain().focus();
  const item = editor.isActive("taskItem") ? "taskItem" : "listItem";
  const btn = (icon: string, label: string, active: boolean, run: () => void, disabled = false) => (
    <button
      key={label}
      type="button"
      className={`kb-btn${active ? " is-active" : ""}`}
      aria-label={label}
      disabled={disabled}
      // Keep the keyboard open: don't let the tap move focus away from the note.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon name={icon} size={20} />
    </button>
  );

  return (
    <div className="kb-bar" role="toolbar" aria-label="Formatting">
      <div className="kb-scroll">
        {btn("checklist", "Checklist", s.task, () => c().toggleTaskList().run())}
        {btn("bulletList", "Bulleted list", s.bullet, () => c().toggleBulletList().run())}
        {btn("orderedList", "Numbered list", s.ordered, () => c().toggleOrderedList().run())}
        {btn("image", "Add picture", false, onInsertImage)}
        <span className="kb-sep" />
        {btn("bold", "Bold", s.bold, () => c().toggleBold().run())}
        {btn("italic", "Italic", s.italic, () => c().toggleItalic().run())}
        {btn("underline", "Underline", s.underline, () => c().toggleUnderline().run())}
        {btn("strike", "Strikethrough", s.strike, () => c().toggleStrike().run())}
        {btn("highlight", "Highlight", s.highlight, () => c().toggleHighlight({ color: "#fff1a8" }).run())}
        <span className="kb-sep" />
        {btn("outdent", "Outdent", false, () => c().liftListItem(item).run(), !s.inList)}
        {btn("indent", "Indent", false, () => c().sinkListItem(item).run(), !s.inList)}
        {btn("undo", "Undo", false, () => c().undo().run(), !s.canUndo)}
      </div>
      <button
        type="button"
        className="kb-done"
        aria-label="Hide keyboard"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
      >
        <Icon name="chevronDown" size={20} />
      </button>
    </div>
  );
}
