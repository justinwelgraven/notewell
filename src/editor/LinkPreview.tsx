import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { basicMeta, fetchLinkMeta } from "../lib/metadata";

/** Links already re-tried this session (simple cards upgrade to a full preview at most once). */
const retried = new Set<string>();
import { hostname } from "../lib/embeds";
import { openExternal } from "../lib/storage";
import { Icon } from "../components/Icon";
import { replaceWithLink } from "./SmartPaste";

/** A website "bookmark card": title, description, image and site name of a pasted link. */
export const LinkPreview = Node.create({
  name: "linkPreview",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: { default: null },
      title: { default: null },
      description: { default: null },
      image: { default: null },
      siteName: { default: null },
      favicon: { default: null },
      status: { default: "loading" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-link-preview]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-link-preview": "" }),
      ["a", { href: HTMLAttributes.url }, HTMLAttributes.title || HTMLAttributes.url || ""],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkPreviewView);
  },
});

function LinkPreviewView({ node, editor, getPos, selected, deleteNode }: NodeViewProps) {
  const { url, title, description, image, siteName, favicon, status } = node.attrs as Record<string, string | null>;
  const [imgOk, setImgOk] = useState(true);
  const [iconOk, setIconOk] = useState(true);

  useEffect(() => {
    // "basic" = only the simple card could be made earlier: try for a full preview again (once per
    // link per session) — e.g. the preview service's daily limit has reset by now.
    const retry = (status === "basic" || status === "error") && !!url && !retried.has(url) && navigator.onLine;
    if ((status !== "loading" && !retry) || !url) return;
    if (retry) retried.add(url);
    let cancelled = false;
    const apply = (attrs: Record<string, unknown>) => {
      if (cancelled) return;
      const pos = getPos();
      if (typeof pos !== "number") return;
      const current = editor.state.doc.nodeAt(pos);
      if (!current || current.type.name !== "linkPreview") return;
      // Metadata arriving later shouldn't become its own undo step.
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }).setMeta("addToHistory", false);
      editor.view.dispatch(tr);
    };
    fetchLinkMeta(url)
      .then((meta) => apply({ ...meta, status: "ready" }))
      .catch(() => {
        // No full preview: show a simple card (only when it's still loading — never replace a good one).
        if (status === "loading") apply({ ...basicMeta(url), status: "basic" });
      });
    return () => {
      cancelled = true;
    };
  }, [url, status]);

  const loading = status === "loading";
  const showImage = !!image && imgOk;

  return (
    <NodeViewWrapper className={`lp-card${selected ? " is-selected" : ""}`} data-drag-handle>
      <div
        className="lp-main"
        role="link"
        title={url ?? ""}
        onClick={() => url && openExternal(url)}
      >
        <div className="lp-text">
          <div className={`lp-title${loading ? " is-loading" : ""}`}>
            {loading ? "Loading preview…" : title || url}
          </div>
          {description && <div className="lp-desc">{description}</div>}
          <div className="lp-site">
            {favicon && iconOk ? (
              <img src={favicon} alt="" onError={() => setIconOk(false)} />
            ) : (
              <span className="lp-site-dot"><Icon name="globe" size={12} /></span>
            )}
            <span>{siteName || (url ? hostname(url) : "")}</span>
          </div>
        </div>
        {showImage && (
          <div className="lp-image">
            <img src={image!} alt="" onError={() => setImgOk(false)} />
          </div>
        )}
      </div>
      {editor.isEditable && (
        <div className="node-actions" contentEditable={false}>
          <button title="Open in browser" onClick={() => url && openExternal(url)}>
            <Icon name="external" size={14} />
          </button>
          <button title="Show as plain link" onClick={() => replaceWithLink(editor, getPos(), node.nodeSize, url!)}>
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
