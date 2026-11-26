import { Extension } from "@tiptap/core";

/**
 * Evernote-style formatting shortcuts ("Mod" = Ctrl on Windows, ⌘ on Mac).
 * These come on top of the editor's built-in ones (Ctrl+B/I/U, Ctrl+Alt+1-3 for headings,
 * Ctrl+Shift+7/8/9 for lists, Tab/Shift+Tab to indent list items, Markdown-style typing like "- " or "[ ] ").
 */
export const EvernoteShortcuts = Extension.create({
  name: "evernoteShortcuts",
  priority: 1000, // win over built-in bindings for the same keys (e.g. Ctrl+Shift+B)

  addKeyboardShortcuts() {
    const e = this.editor;
    return {
      "Mod-Shift-b": () => e.chain().focus().toggleBulletList().run(),
      "Mod-Shift-o": () => e.chain().focus().toggleOrderedList().run(),
      "Mod-Shift-c": () => e.chain().focus().toggleTaskList().run(),
      "Mod-t": () => e.chain().focus().toggleStrike().run(),
      "Mod-Shift-h": () => e.chain().focus().toggleHighlight({ color: "#fff1a8" }).run(),
      "Mod-Shift-l": () => e.chain().focus().toggleCodeBlock().run(),
      "Mod-Shift-q": () => e.chain().focus().toggleBlockquote().run(),
      "Mod-Shift--": () => e.chain().focus().setHorizontalRule().run(),
      "Mod-Shift-_": () => e.chain().focus().setHorizontalRule().run(),
      "Mod-\\": () => e.chain().focus().unsetAllMarks().clearNodes().run(),
      "Mod-Alt-0": () => e.chain().focus().setParagraph().run(),
      // Tick / untick the checklist item the cursor is in.
      "Mod-Enter": () =>
        e.commands.command(({ tr, state }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === "taskItem") {
              tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, checked: !node.attrs.checked });
              return true;
            }
          }
          return false;
        }),
    };
  },
});
