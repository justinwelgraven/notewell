import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isUrl, parseEmbed } from "../lib/embeds";

/** Inserts a URL as a player (YouTube/Spotify) or a link preview card. */
export function insertUrlBlock(editor: Editor, url: string) {
  const embed = parseEmbed(url);
  const node = embed
    ? { type: "embed", attrs: { provider: embed.provider, url, src: embed.src, height: embed.height, thumb: embed.thumb } }
    : { type: "linkPreview", attrs: { url, status: "loading" } };
  editor.chain().focus().insertContent([node, { type: "paragraph" }]).run();
}

/** Turns a card/player back into a normal text link. */
export function replaceWithLink(editor: Editor, pos: number | undefined, size: number, url: string) {
  if (typeof pos !== "number") return;
  editor
    .chain()
    .focus()
    .insertContentAt(
      { from: pos, to: pos + size },
      { type: "paragraph", content: [{ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }] },
    )
    .run();
}

/**
 * Pasting a bare URL:
 *  - with text selected → links the selection
 *  - YouTube / Spotify → embedded player
 *  - anything else → link preview card
 * Hold Shift while pasting (Ctrl+Shift+V) to paste plain text instead.
 */
export const SmartPaste = Extension.create({
  name: "smartPaste",
  priority: 1000,

  addProseMirrorPlugins() {
    const editor = this.editor;
    let shiftHeld = false;
    return [
      new Plugin({
        key: new PluginKey("smartPaste"),
        props: {
          handleKeyDown(_view, event) {
            shiftHeld = event.shiftKey;
            return false;
          },
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain")?.trim();
            if (!text || !isUrl(text) || shiftHeld) return false;
            if (editor.isActive("codeBlock")) return false;
            if (!view.state.selection.empty) {
              editor.chain().focus().setLink({ href: text }).run();
              return true;
            }
            insertUrlBlock(editor, text);
            return true;
          },
        },
      }),
    ];
  },
});
