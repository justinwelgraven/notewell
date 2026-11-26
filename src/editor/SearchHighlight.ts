import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Highlights the current search words in the open note (not saved in the note). */
const key = new PluginKey<DecorationSet>("searchHighlight");

function build(doc: PMNode, term: string): DecorationSet {
  const q = term.trim().toLowerCase();
  if (!q) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let i = text.indexOf(q);
    while (i !== -1) {
      decos.push(Decoration.inline(pos + i, pos + i + q.length, { class: "search-hit" }));
      i = text.indexOf(q, i + q.length);
    }
  });
  return DecorationSet.create(doc, decos);
}

export const SearchHighlight = Extension.create({
  name: "searchHighlight",
  addStorage() {
    return { term: "" };
  },
  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => build(state.doc, ext.storage.term),
          apply: (tr, old) => (tr.getMeta(key) !== undefined || tr.docChanged ? build(tr.doc, ext.storage.term) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

/** Sets the words to highlight; scrolls the first match into view when asked. */
export function setSearchHighlight(editor: Editor, term: string, scroll = false) {
  if (editor.isDestroyed) return;
  (editor.storage as unknown as Record<string, { term: string }>).searchHighlight.term = term;
  editor.view.dispatch(editor.state.tr.setMeta(key, term).setMeta("addToHistory", false));
  if (scroll && term.trim()) {
    requestAnimationFrame(() => editor.view.dom.querySelector(".search-hit")?.scrollIntoView({ block: "center" }));
  }
}
