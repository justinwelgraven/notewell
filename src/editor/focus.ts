import type { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";

/**
 * Moves the cursor to the start of the note body *immediately*.
 * (TipTap's focus() command waits a frame, so keys typed right after
 * pressing Enter in the title would still land in the title.)
 */
export function focusBodyStart(editor: Editor | null) {
  if (!editor) return;
  const { state, view } = editor;
  view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)).scrollIntoView());
  view.focus();
}
