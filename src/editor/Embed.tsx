import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { openExternal } from "../lib/storage";
import { Icon } from "../components/Icon";
import { replaceWithLink } from "./SmartPaste";

/** Embedded YouTube / Spotify player. */
export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      provider: { default: null },
      url: { default: null },
      src: { default: null },
      height: { default: null },
      thumb: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-embed": "" }),
      ["a", { href: HTMLAttributes.url }, HTMLAttributes.url || ""],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});

function EmbedView({ node, editor, getPos, selected, deleteNode }: NodeViewProps) {
  const { provider, url, src, height } = node.attrs as { provider: string; url: string; src: string; height: number | null };
  const isYouTube = provider === "youtube";

  return (
    <NodeViewWrapper className={`embed-block embed-${provider}${selected ? " is-selected" : ""}`} data-drag-handle>
      <div className="embed-frame" style={isYouTube ? undefined : { height: height ?? 152 }}>
        {isYouTube ? (
          <iframe
            src={src}
            title="YouTube video player"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <iframe
            src={src}
            title="Spotify player"
            height={height ?? 152}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
          />
        )}
      </div>
      {editor.isEditable && (
        <div className="node-actions" contentEditable={false}>
          <button title={`Open in ${isYouTube ? "YouTube" : "Spotify"}`} onClick={() => openExternal(url)}>
            <Icon name="external" size={14} />
          </button>
          <button title="Show as plain link" onClick={() => replaceWithLink(editor, getPos(), node.nodeSize, url)}>
            <Icon name="link" size={14} />
          </button>
          <button title="Remove" onClick={() => deleteNode()}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
