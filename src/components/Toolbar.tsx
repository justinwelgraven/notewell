import { useEditorState, type Editor } from "@tiptap/react";
import { isMac, kbd } from "../lib/keys";
import { Icon } from "./Icon";
import { Dropdown, MenuItem } from "./Menu";

/** Per-selection text size (in More). The default size for all notes is in "Text size & margins". */
const SIZE_CHOICES: [string, number | null][] = [
  ["Small", 13],
  ["Normal", null],
  ["Large", 20],
  ["Huge", 28],
];

const TEXT_COLORS = [
  { name: "Default", value: null },
  { name: "Gray", value: "#8a8a8a" },
  { name: "Red", value: "#e03b3b" },
  { name: "Orange", value: "#f0801a" },
  { name: "Yellow", value: "#d4a500" },
  { name: "Green", value: "#14995b" },
  { name: "Blue", value: "#2f6fde" },
  { name: "Purple", value: "#8b4fd8" },
];

const HIGHLIGHTS = [
  { name: "Yellow", value: "#fff1a8" },
  { name: "Green", value: "#c9f2d6" },
  { name: "Blue", value: "#cde3ff" },
  { name: "Pink", value: "#ffd6e7" },
  { name: "Orange", value: "#ffe0bf" },
  { name: "Purple", value: "#e6dbff" },
];

interface Props {
  editor: Editor;
  onLink: () => void;
  onInsertUrl: () => void;
  onInsertImage: () => void;
}

export default function Toolbar({ editor, onLink, onInsertUrl, onInsertImage }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const ts = e.getAttributes("textStyle");
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        code: e.isActive("code"),
        highlight: e.isActive("highlight"),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        task: e.isActive("taskList"),
        link: e.isActive("link"),
        quote: e.isActive("blockquote"),
        codeBlock: e.isActive("codeBlock"),
        h1: e.isActive("heading", { level: 1 }),
        h2: e.isActive("heading", { level: 2 }),
        h3: e.isActive("heading", { level: 3 }),
        alignCenter: e.isActive({ textAlign: "center" }),
        alignRight: e.isActive({ textAlign: "right" }),
        fontSize: (ts.fontSize as string | undefined) ?? null,
        color: (ts.color as string | undefined) ?? null,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        canSink: e.can().sinkListItem("listItem") || e.can().sinkListItem("taskItem"),
        canLift: e.can().liftListItem("listItem") || e.can().liftListItem("taskItem"),
      };
    },
  });

  const c = () => editor.chain().focus();
  const styleLabel = s.h1 ? "Large header" : s.h2 ? "Medium header" : s.h3 ? "Small header" : s.codeBlock ? "Code block" : "Normal text";
  const sizeLabel = s.fontSize ? parseInt(s.fontSize) : null;

  const Btn = ({ icon, title, active, onClick, disabled }: { icon: string; title: string; active?: boolean; onClick: () => void; disabled?: boolean }) => (
    <button
      type="button"
      className={`tb-btn${active ? " is-active" : ""}`}
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} size={18} />
    </button>
  );

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Dropdown
        trigger={<><Icon name="plus" size={16} /><span>Insert</span><Icon name="chevronDown" size={12} /></>}
        triggerClassName="tb-insert"
        title="Insert"
      >
        {(close) => (
          <>
            <MenuItem onSelect={() => { close(); c().toggleTaskList().run(); }}>
              <Icon name="checklist" size={16} /> Checklist
            </MenuItem>
            <MenuItem onSelect={() => { close(); onInsertImage(); }}>
              <Icon name="image" size={16} /> Picture
            </MenuItem>
            <MenuItem onSelect={() => { close(); onInsertUrl(); }}>
              <Icon name="globe" size={16} /> Link preview / YouTube / Spotify
            </MenuItem>
            <MenuItem onSelect={() => { close(); onLink(); }} shortcut={kbd("Ctrl+K")}>
              <Icon name="link" size={16} /> Link
            </MenuItem>
            <MenuItem onSelect={() => { close(); c().toggleCodeBlock().run(); }}>
              <Icon name="code" size={16} /> Code block
            </MenuItem>
            <MenuItem onSelect={() => { close(); c().toggleBlockquote().run(); }}>
              <Icon name="quote" size={16} /> Quote
            </MenuItem>
            <MenuItem onSelect={() => { close(); c().setHorizontalRule().run(); }}>
              <Icon name="divider" size={16} /> Divider
            </MenuItem>
          </>
        )}
      </Dropdown>

      <span className="tb-sep" />
      <Btn icon="undo" title={`Undo (${kbd("Ctrl+Z")})`} disabled={!s.canUndo} onClick={() => c().undo().run()} />
      <Btn icon="redo" title={`Redo (${isMac ? kbd("Ctrl+Shift+Z") : "Ctrl+Y"})`} disabled={!s.canRedo} onClick={() => c().redo().run()} />
      <span className="tb-sep" />

      <Dropdown trigger={<><span className="tb-select-label w-style">{styleLabel}</span><Icon name="chevronDown" size={12} /></>} triggerClassName="tb-select" title="Text style">
        {(close) => (
          <>
            <MenuItem active={styleLabel === "Normal text"} onSelect={() => { close(); c().setParagraph().run(); }}>Normal text</MenuItem>
            <MenuItem active={s.h1} onSelect={() => { close(); c().toggleHeading({ level: 1 }).run(); }}>
              <span className="menu-h1">Large header</span>
            </MenuItem>
            <MenuItem active={s.h2} onSelect={() => { close(); c().toggleHeading({ level: 2 }).run(); }}>
              <span className="menu-h2">Medium header</span>
            </MenuItem>
            <MenuItem active={s.h3} onSelect={() => { close(); c().toggleHeading({ level: 3 }).run(); }}>
              <span className="menu-h3">Small header</span>
            </MenuItem>
            <MenuItem active={s.codeBlock} onSelect={() => { close(); c().toggleCodeBlock().run(); }}>
              <span className="menu-mono">Code block</span>
            </MenuItem>
          </>
        )}
      </Dropdown>

      <span className="tb-sep" />

      <Dropdown
        trigger={
          <span className="tb-color">
            <Icon name="textColor" size={18} />
            <span className="tb-color-bar" style={{ background: s.color ?? "var(--text)" }} />
          </span>
        }
        title="Text color"
      >
        {(close) => (
          <div className="swatches">
            {TEXT_COLORS.map((col) => (
              <button
                key={col.name}
                className={`swatch${s.color === col.value ? " is-active" : ""}`}
                title={col.name}
                style={{ background: col.value ?? "var(--text)" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  close();
                  if (col.value) c().setColor(col.value).run();
                  else c().unsetColor().run();
                }}
              />
            ))}
          </div>
        )}
      </Dropdown>

      <Btn icon="bold" title={`Bold (${kbd("Ctrl+B")})`} active={s.bold} onClick={() => c().toggleBold().run()} />
      <Btn icon="italic" title={`Italic (${kbd("Ctrl+I")})`} active={s.italic} onClick={() => c().toggleItalic().run()} />
      <Btn icon="underline" title={`Underline (${kbd("Ctrl+U")})`} active={s.underline} onClick={() => c().toggleUnderline().run()} />

      <Dropdown trigger={<Icon name="highlight" size={18} />} title="Highlight" triggerClassName={`tb-btn${s.highlight ? " is-active" : ""}`}>
        {(close) => (
          <div className="swatches">
            {HIGHLIGHTS.map((h) => (
              <button
                key={h.name}
                className="swatch"
                title={h.name}
                style={{ background: h.value }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { close(); c().setHighlight({ color: h.value }).run(); }}
              />
            ))}
            <button
              className="swatch swatch-none"
              title="No highlight"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { close(); c().unsetHighlight().run(); }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        )}
      </Dropdown>

      <span className="tb-sep" />
      <Btn icon="bulletList" title="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()} />
      <Btn icon="orderedList" title="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()} />
      <Btn icon="checklist" title="Checklist" active={s.task} onClick={() => c().toggleTaskList().run()} />
      <span className="tb-sep" />
      <Btn icon="link" title={`Link (${kbd("Ctrl+K")})`} active={s.link} onClick={onLink} />

      <Dropdown trigger={<Icon name="more" size={18} />} title="More formatting" align="right">
        {(close) => (
          <div className="tb-more">
            <div className="menu-heading">Text size</div>
            <div className="tb-chips">
              {SIZE_CHOICES.map(([label, px]) => (
                <button
                  key={label}
                  className={(px === null ? !s.fontSize : sizeLabel === px) ? "is-active" : ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    close();
                    if (px === null) c().unsetFontSize().run();
                    else c().setFontSize(`${px}px`).run();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="menu-heading">Alignment &amp; indent</div>
            <div className="tb-row">
              <Btn icon="alignLeft" title="Align left" active={!s.alignCenter && !s.alignRight} onClick={() => { close(); c().setTextAlign("left").run(); }} />
              <Btn icon="alignCenter" title="Align center" active={s.alignCenter} onClick={() => { close(); c().setTextAlign("center").run(); }} />
              <Btn icon="alignRight" title="Align right" active={s.alignRight} onClick={() => { close(); c().setTextAlign("right").run(); }} />
              <span className="tb-sep" />
              <Btn
                icon="outdent"
                title="Outdent (Shift+Tab)"
                disabled={!s.canLift}
                onClick={() => (editor.isActive("taskItem") ? c().liftListItem("taskItem").run() : c().liftListItem("listItem").run())}
              />
              <Btn
                icon="indent"
                title="Indent (Tab)"
                disabled={!s.canSink}
                onClick={() => (editor.isActive("taskItem") ? c().sinkListItem("taskItem").run() : c().sinkListItem("listItem").run())}
              />
            </div>
            <div className="menu-sep" />
            <MenuItem active={s.strike} onSelect={() => { close(); c().toggleStrike().run(); }} shortcut={kbd("Ctrl+T")}>
              <Icon name="strike" size={16} /> Strikethrough
            </MenuItem>
            <MenuItem active={s.code} onSelect={() => { close(); c().toggleCode().run(); }} shortcut={kbd("Ctrl+E")}>
              <Icon name="code" size={16} /> Inline code
            </MenuItem>
            <MenuItem active={s.quote} onSelect={() => { close(); c().toggleBlockquote().run(); }}>
              <Icon name="quote" size={16} /> Quote
            </MenuItem>
            <MenuItem onSelect={() => { close(); c().setHorizontalRule().run(); }}>
              <Icon name="divider" size={16} /> Divider
            </MenuItem>
            <MenuItem onSelect={() => { close(); c().unsetAllMarks().clearNodes().run(); }} shortcut={kbd("Ctrl+\\")}>
              <Icon name="clearFormat" size={16} /> Clear formatting
            </MenuItem>
          </div>
        )}
      </Dropdown>
    </div>
  );
}
