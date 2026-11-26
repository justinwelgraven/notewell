import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { LinkPreview } from "./LinkPreview";
import { Embed } from "./Embed";
import { SmartPaste } from "./SmartPaste";
import { Hashtags } from "./Hashtags";
import { EvernoteShortcuts } from "./Shortcuts";
import { NoteImage } from "./NoteImage";
import { SearchHighlight } from "./SearchHighlight";
import { NoteLink } from "./NoteLink";
import { isMac } from "../lib/keys";
import { NativeSpell, nativeSpellcheck } from "./NativeSpell";

/**
 * Attributes of the note text. On Apple devices the text is *not* marked as English (lang=""), so the
 * system spell checker detects each sentence's language itself (English and Dutch). Windows checks all
 * installed spell-check languages regardless, so it keeps the page language.
 */
export const noteBodyAttributes: Record<string, string> = {
  // Windows app: our own English + Dutch check (NativeSpell) replaces the browser's English-only one.
  spellcheck: nativeSpellcheck ? "false" : "true",
  class: "note-body",
  ...(isMac ? { lang: "" } : {}),
};

export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
  Placeholder.configure({ placeholder: "Start writing…" }),
  LinkPreview,
  Embed,
  NoteImage,
  NoteLink,
  SmartPaste,
  SearchHighlight,
  NativeSpell,
  Hashtags,
  EvernoteShortcuts,
];
