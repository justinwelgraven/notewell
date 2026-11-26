import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * UpNote-style inline tags: "#groceries" in the text becomes the tag "groceries".
 * A hashtag must start a word and begin with a letter, so "#1", "C#" and "site.com/#top" are ignored,
 * and "# " (with a space) still makes a heading.
 */
const HASHTAG = /(^|[\s(\[{"'“])#([\p{L}][\p{L}\p{N}_\-/]*)/gu;

interface Found {
  tag: string;
  from: number;
  to: number;
}

function findHashtags(doc: PMNode): Found[] {
  const out: Found[] = [];
  doc.descendants((node, pos, parent) => {
    if (parent?.type.name === "codeBlock") return false;
    if (!node.isText || !node.text || node.marks.some((m) => m.type.name === "code" || m.type.name === "link")) return;
    HASHTAG.lastIndex = 0;
    for (let m: RegExpExecArray | null; (m = HASHTAG.exec(node.text)); ) {
      const tag = m[2].replace(/[-/_]+$/, "");
      const from = pos + m.index + m[1].length;
      out.push({ tag, from, to: from + 1 + tag.length });
    }
  });
  return out;
}

/**
 * Hashtags the user has finished typing (the cursor isn't right at the end of them),
 * so typing "#gro" doesn't create the tags "g", "gr" and "gro" along the way.
 * Pass cursor = -1 to get all of them.
 */
export function completedHashtags(doc: PMNode, cursor: number): string[] {
  const seen = new Map<string, string>();
  for (const h of findHashtags(doc)) {
    if (h.to === cursor) continue;
    const key = h.tag.toLowerCase();
    if (!seen.has(key)) seen.set(key, h.tag);
  }
  return [...seen.values()];
}

/** Adds the hashtags in a note to its tag list (case-insensitive, existing tags keep their spelling). */
export function mergeTags(tags: string[], found: string[]): string[] | null {
  const have = new Set(tags.map((t) => t.toLowerCase()));
  const added = found.filter((t) => !have.has(t.toLowerCase()));
  return added.length ? [...tags, ...added] : null;
}

export const Hashtags = Extension.create({
  name: "hashtags",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("hashtags"),
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

function build(doc: PMNode): DecorationSet {
  return DecorationSet.create(
    doc,
    findHashtags(doc).map((h) =>
      Decoration.inline(h.from, h.to, {
        class: "hashtag",
        "data-tag": h.tag,
        title: `Tag “${h.tag}” · Ctrl/⌘+click to see all notes with this tag`,
      }),
    ),
  );
}
