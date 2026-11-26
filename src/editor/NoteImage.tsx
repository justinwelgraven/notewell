import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { addImage, loadImage, onImageLoaderChange } from "../lib/images";

/** A picture in a note. Only the id is stored in the note; see lib/images.ts. */
export const NoteImage = Node.create({
  name: "noteImage",
  group: "block",
  atom: true,
  // Not draggable: on the desktop apps a draggable picture could get stuck "half-dragged", so a click
  // elsewhere didn't deselect it. Move pictures with cut & paste.
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      id: { default: null },
      /** "full" (fits the note width) or "small" (half width). */
      size: { default: "full" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-note-image]", getAttrs: (el) => ({ id: (el as HTMLElement).dataset.id }) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-note-image": "", "data-id": HTMLAttributes.id })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteImageView);
  },
});

/** Stores the pictures and inserts them at the cursor (or at `pos`). */
export async function insertImages(editor: Editor, files: File[], pos?: number) {
  const nodes = [];
  for (const f of files) {
    try {
      nodes.push({ type: "noteImage", attrs: { id: await addImage(f) } });
    } catch (e) {
      console.warn("Couldn't add picture", e);
    }
  }
  if (!nodes.length || editor.isDestroyed) return;
  const content = [...nodes, { type: "paragraph" }];
  if (typeof pos === "number") editor.chain().focus().insertContentAt(pos, content).run();
  else editor.chain().focus().insertContent(content).run();
}

function NoteImageView({ node, editor, selected, deleteNode, updateAttributes, getPos }: NodeViewProps) {
  const id = node.attrs.id as string | null;
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => onImageLoaderChange(() => setRetry((r) => r + 1)), []);
  useEffect(() => {
    if (!id) return;
    let live = true;
    setMissing(false);
    loadImage(id)
      .then((d) => live && setSrc(d))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [id, retry]);

  const small = node.attrs.size === "small";
  return (
    <NodeViewWrapper className={`ni-wrap${selected ? " is-selected" : ""}${small ? " is-small" : ""}`}>
      {src ? (
        <img
          className="ni-img"
          src={src}
          alt=""
          draggable={false}
          // One click selects the picture (shows its buttons); a click anywhere else deselects it.
          onMouseDown={(e) => {
            if (e.button !== 0 || !editor.isEditable) return;
            e.preventDefault();
            const pos = getPos();
            if (typeof pos === "number") editor.chain().focus().setNodeSelection(pos).run();
          }}
        />
      ) : (
        <div className="ni-placeholder">
          <Icon name="image" size={22} />
          <span>{missing ? "Picture not synced to this device yet" : "Loading picture…"}</span>
          {missing && (
            <button onClick={() => setRetry((r) => r + 1)} contentEditable={false}>
              Try again
            </button>
          )}
        </div>
      )}
      {editor.isEditable && (
        <div className="node-actions" contentEditable={false}>
          <button title={small ? "Full width" : "Smaller"} onClick={() => updateAttributes({ size: small ? "full" : "small" })}>
            <Icon name={small ? "expand" : "collapse"} size={14} />
          </button>
          <button title="Remove picture" onClick={() => deleteNode()}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
