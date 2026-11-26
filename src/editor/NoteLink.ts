/**
 * Links between notes. Type "[[" and pick a note: an inline link that shows the target's current
 * title and opens it on click. The note stores the target's id (and its title at the time, as a
 * fallback if the target is later deleted).
 */
import { Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";

export interface LinkTarget {
  id: string;
  title: string;
  trashed: boolean;
}

/** App tells the editor which notes exist (for the "[[" list and live titles). */
let source: () => LinkTarget[] = () => [];
let currentNoteId: string | null = null;
export function setNoteLinkSource(fn: () => LinkTarget[]) {
  source = fn;
}
export function setCurrentNoteForLinks(id: string | null) {
  currentNoteId = id;
}
const titleOf = (id: string, fallback: string) => {
  const t = source().find((n) => n.id === id);
  return t ? t.title.trim() || "Untitled" : fallback || "Missing note";
};

/** Ids of the notes a note body links to (cached per note body, which never changes in place). */
const cache = new WeakMap<object, string[]>();
export function linkedNoteIds(content: JSONContent | null): string[] {
  if (!content) return [];
  let ids = cache.get(content);
  if (!ids) {
    const out = new Set<string>();
    const walk = (n: JSONContent) => {
      if (n.type === "noteLink" && n.attrs?.id) out.add(n.attrs.id);
      n.content?.forEach(walk);
    };
    walk(content);
    ids = [...out];
    cache.set(content, ids);
  }
  return ids;
}

const suggestionKey = new PluginKey("noteLinkSuggestion");

export const NoteLink = Node.create({
  name: "noteLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { id: { default: null }, title: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "a[data-note-link]", getAttrs: (el) => ({ id: (el as HTMLElement).dataset.noteLink, title: (el as HTMLElement).textContent }) }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes, { "data-note-link": node.attrs.id, class: "note-link" }), titleOf(node.attrs.id, node.attrs.title)];
  },

  renderText({ node }) {
    return titleOf(node.attrs.id, node.attrs.title);
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("a");
      dom.className = "note-link";
      dom.contentEditable = "false";
      const missing = !source().some((n) => n.id === node.attrs.id);
      if (missing) dom.classList.add("is-missing");
      dom.textContent = titleOf(node.attrs.id, node.attrs.title);
      dom.title = missing ? "This note no longer exists" : "Open note";
      dom.addEventListener("mousedown", (e) => e.preventDefault());
      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!missing) window.dispatchEvent(new CustomEvent("notewell:open-note", { detail: node.attrs.id }));
      });
      return { dom };
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      Suggestion<LinkTarget>({
        editor,
        pluginKey: suggestionKey,
        char: "[[",
        allowSpaces: true,
        startOfLine: false,
        items: ({ query }) => {
          const q = query.trim().toLowerCase();
          return source()
            .filter((n) => !n.trashed && n.id !== currentNoteId && (n.title || "Untitled").toLowerCase().includes(q))
            .sort((a, b) => Number(!(a.title || "").toLowerCase().startsWith(q)) - Number(!(b.title || "").toLowerCase().startsWith(q)))
            .slice(0, 8);
        },
        command: ({ editor: ed, range, props }) => {
          ed.chain()
            .focus()
            .insertContentAt(range, [
              { type: "noteLink", attrs: { id: props.id, title: props.title.trim() || "Untitled" } },
              { type: "text", text: " " },
            ])
            .run();
        },
        render: () => {
          let el: HTMLDivElement | null = null;
          let items: LinkTarget[] = [];
          let active = 0;
          let props: SuggestionProps<LinkTarget> | null = null;
          const draw = () => {
            if (!el || !props) return;
            el.innerHTML = "";
            const head = document.createElement("div");
            head.className = "nl-pop-head";
            head.textContent = items.length ? "Link to note" : "No matching notes";
            el.appendChild(head);
            items.forEach((it, i) => {
              const b = document.createElement("button");
              b.type = "button";
              b.className = `nl-pop-item${i === active ? " is-active" : ""}`;
              b.textContent = it.title.trim() || "Untitled";
              b.addEventListener("mousedown", (e) => {
                e.preventDefault();
                props?.command(it);
              });
              el!.appendChild(b);
            });
            const rect = props.clientRect?.();
            if (rect) {
              const w = 260;
              el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - w - 8))}px`;
              const below = rect.bottom + 6;
              const h = el.offsetHeight || 200;
              el.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 6) : below}px`;
            }
          };
          return {
            onStart: (p) => {
              props = p;
              items = p.items;
              active = 0;
              el = document.createElement("div");
              el.className = "nl-pop";
              document.body.appendChild(el);
              draw();
            },
            onUpdate: (p) => {
              props = p;
              items = p.items;
              active = Math.min(active, Math.max(0, items.length - 1));
              draw();
            },
            onKeyDown: ({ event }) => {
              if (event.key === "Escape") {
                el?.remove();
                el = null;
                return true;
              }
              if (!items.length) return false;
              if (event.key === "ArrowDown") active = (active + 1) % items.length;
              else if (event.key === "ArrowUp") active = (active - 1 + items.length) % items.length;
              else if (event.key === "Enter" || event.key === "Tab") {
                props?.command(items[active]);
                return true;
              } else return false;
              draw();
              return true;
            },
            onExit: () => {
              el?.remove();
              el = null;
            },
          };
        },
      }),
    ];
  },
});
