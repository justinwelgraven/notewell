/**
 * Windows desktop: spell checking in English and Dutch together, using Windows' own spell checker
 * (src-tauri/src/spell.rs). WebView2 can only check one language, so on Windows the browser's spell
 * check is switched off in the note text and this plugin draws the red underlines itself, with its
 * own right-click menu (suggestions, Add to dictionary, Ignore).
 *
 * Paragraphs are checked once per version: results are cached per ProseMirror node, and unchanged
 * paragraphs keep the same node object between edits, so typing only re-checks the paragraph you're in.
 * Mac / iPhone / web: inactive (the system spell checker handles both languages there).
 */
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { isTauri } from "../lib/storage";

/** True in the Windows desktop app. */
export const nativeSpellcheck = isTauri && /Windows/i.test(navigator.userAgent);

type Ranges = [number, number][];

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

let languages: Promise<string[]> | null = null;
/** Windows spell-check languages available ([] → fall back to the browser's own spell check). */
export function spellLanguages(): Promise<string[]> {
  languages ??= nativeSpellcheck ? invoke<string[]>("spell_languages").catch(() => []) : Promise.resolve([]);
  return languages;
}

/** Results per paragraph node; replaced (= everything re-checked) after "Add to dictionary"/"Ignore". */
let cache = new WeakMap<PMNode, Ranges>();
const listeners = new Set<() => void>();
function resetCache() {
  cache = new WeakMap();
  listeners.forEach((l) => l());
}

/** A paragraph's text for checking, with a map from text index to position inside the paragraph. */
function blockText(block: PMNode): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  block.forEach((child, offset) => {
    if (child.isText && child.text) {
      // Code and links aren't checked (blanked out with spaces, keeping the positions).
      const skip = child.marks.some((m) => m.type.name === "code" || m.type.name === "link");
      for (let i = 0; i < child.text.length; i++) {
        text += skip ? " " : child.text[i];
        map.push(offset + i);
      }
    } else {
      text += " "; // pictures, note links, line breaks: a word boundary
      map.push(offset);
    }
  });
  return { text, map };
}

function textblocks(doc: PMNode): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") return false;
    if (node.isTextblock) {
      out.push({ node, pos });
      return false;
    }
    return true;
  });
  return out;
}

const key = new PluginKey<DecorationSet>("nativeSpell");

/** Underlines for everything checked so far; the word being typed isn't marked until you move on. */
function buildDecorations(state: EditorState, typing: boolean): DecorationSet {
  const decos: Decoration[] = [];
  const { empty, from: cursor } = state.selection;
  for (const { node, pos } of textblocks(state.doc)) {
    const ranges = cache.get(node);
    if (!ranges?.length) continue;
    const { map } = blockText(node);
    for (const [start, len] of ranges) {
      if (start + len > map.length) continue;
      const from = pos + 1 + map[start];
      const to = pos + 1 + map[start + len - 1] + 1;
      if (typing && empty && cursor >= from && cursor <= to) continue;
      decos.push(Decoration.inline(from, to, { class: "spell-error" }, { spell: true }));
    }
  }
  return DecorationSet.create(state.doc, decos);
}

// ---- Right-click menu ----
let menuEl: HTMLDivElement | null = null;
function closeMenu() {
  menuEl?.remove();
  menuEl = null;
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("keydown", onEsc, true);
}
function onOutside(e: MouseEvent) {
  if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
}
function onEsc(e: KeyboardEvent) {
  if (e.key === "Escape") closeMenu();
}

function openMenu(view: EditorView, x: number, y: number, from: number, to: number) {
  closeMenu();
  const word = view.state.doc.textBetween(from, to);
  const el = document.createElement("div");
  el.className = "spell-menu";
  el.style.left = `${Math.min(x, window.innerWidth - 230)}px`;
  el.style.top = `${Math.min(y, window.innerHeight - 260)}px`;
  const item = (label: string, onClick: () => void, cls = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `spell-item ${cls}`;
    b.textContent = label;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      closeMenu();
      onClick();
    });
    return b;
  };
  const list = document.createElement("div");
  list.className = "spell-suggestions";
  list.textContent = "Looking for suggestions…";
  el.appendChild(list);
  const sep = document.createElement("div");
  sep.className = "spell-sep";
  el.appendChild(sep);
  el.appendChild(
    item("Add to dictionary", () => {
      void invoke("spell_add", { word }).then(resetCache);
    }),
  );
  el.appendChild(
    item("Ignore", () => {
      void invoke("spell_ignore", { word }).then(resetCache);
    }),
  );
  document.body.appendChild(el);
  menuEl = el;
  setTimeout(() => {
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onEsc, true);
  });
  invoke<string[]>("spell_suggest", { word })
    .then((suggestions) => {
      if (menuEl !== el) return;
      list.textContent = "";
      if (!suggestions.length) {
        list.textContent = "No suggestions";
        return;
      }
      for (const s of suggestions) {
        list.appendChild(
          item(
            s,
            () => {
              // Only replace if the word is still there.
              if (view.state.doc.textBetween(from, to) !== word) return;
              view.dispatch(view.state.tr.insertText(s, from, to));
              view.focus();
            },
            "is-suggestion",
          ),
        );
      }
    })
    .catch(() => (list.textContent = "No suggestions"));
}

export const NativeSpell = Extension.create({
  name: "nativeSpell",

  addProseMirrorPlugins() {
    if (!nativeSpellcheck) return [];
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => tr.getMeta(key) ?? old.map(tr.mapping, tr.doc),
        },
        props: {
          decorations: (state) => key.getState(state),
          handleDOMEvents: {
            contextmenu: (view, event) => {
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (!at) return false;
              const hit = key.getState(view.state)?.find(at.pos, at.pos, (spec) => spec.spell === true)[0];
              if (!hit) return false;
              event.preventDefault();
              openMenu(view, event.clientX, event.clientY, hit.from, hit.to);
              return true;
            },
          },
        },
        view: (view) => {
          let timer = 0;
          let typing = false;
          let busy = false;
          let alive = true;
          let enabled: boolean | null = null;

          const redraw = () => {
            if (!alive) return;
            view.dispatch(view.state.tr.setMeta(key, buildDecorations(view.state, typing)).setMeta("addToHistory", false));
          };
          const run = async () => {
            if (!alive || busy || enabled === false) return;
            if (enabled === null) {
              enabled = (await spellLanguages()).length > 0;
              // No Windows spell checker at all: give the browser's own check back.
              if (!enabled) {
                view.dom.setAttribute("spellcheck", "true");
                return;
              }
            }
            const todo = textblocks(view.state.doc).filter((b) => !cache.has(b.node));
            if (todo.length) {
              busy = true;
              try {
                const chunk = todo.slice(0, 300);
                const results = await invoke<Ranges[]>("spell_check", { texts: chunk.map((b) => blockText(b.node).text) });
                chunk.forEach((b, i) => cache.set(b.node, results[i] ?? []));
              } catch {
                busy = false;
                return;
              }
              busy = false;
              if (todo.length > 300) schedule(0);
            }
            redraw();
          };
          const schedule = (ms: number) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(run, ms);
          };
          const onReset = () => schedule(0);
          listeners.add(onReset);
          schedule(0);

          return {
            update: (v, prev) => {
              if (!v.state.doc.eq(prev.doc)) {
                typing = true;
                schedule(400);
              } else if (!v.state.selection.eq(prev.selection) && typing) {
                // Moved the cursor away after typing: show the word that was being typed.
                typing = false;
                window.setTimeout(redraw);
              }
            },
            destroy: () => {
              alive = false;
              window.clearTimeout(timer);
              listeners.delete(onReset);
              closeMenu();
            },
          };
        },
      }),
    ];
  },
});
