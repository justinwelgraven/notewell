import type { Fragment, Node as PMNode, Slice } from "@tiptap/pm/model";

/**
 * Builds the plain-text version of copied note content.
 *
 * Chat apps such as WhatsApp only read the plain text from the clipboard, and the editor's
 * default plain text drops list bullets/numbers. This keeps lists, checklists and quotes,
 * and (when `wa` is on) turns bold/italic/strike/code into WhatsApp's *bold* _italic_ ~strike~ `code`.
 */
export function sliceToText(slice: Slice, wa: boolean): string {
  return blocks(slice.content, wa)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\s+$/g, "");
}

function blocks(frag: Fragment, wa: boolean): string[] {
  if (frag.childCount && frag.firstChild!.isInline) return inline(frag, wa).split("\n");
  const out: string[] = [];
  frag.forEach((node) => out.push(...block(node, wa)));
  return out;
}

function block(node: PMNode, wa: boolean): string[] {
  switch (node.type.name) {
    case "paragraph":
      return inline(node.content, wa).split("\n");
    case "heading": {
      const t = inline(node.content, wa, true);
      return [wa && t.trim() ? `*${t.trim()}*` : t];
    }
    case "bulletList":
      return listItems(node, wa, () => (wa ? "- " : "• "));
    case "orderedList": {
      const start = Number(node.attrs.start ?? 1);
      return listItems(node, wa, (i) => `${start + i}. `);
    }
    case "taskList":
      return listItems(node, wa, (_i, item) => (item.attrs.checked ? "☑ " : "☐ "));
    case "blockquote":
      return blocks(node.content, wa).map((l) => "> " + l);
    case "codeBlock": {
      const lines = node.textContent.split("\n");
      return wa ? ["```", ...lines, "```"] : lines;
    }
    case "horizontalRule":
      return ["———"];
    case "linkPreview":
    case "embed":
      // Just the URL: WhatsApp and most chat apps build their own preview from it.
      return [node.attrs.url ?? ""];
    default:
      return node.isTextblock ? inline(node.content, wa).split("\n") : blocks(node.content, wa);
  }
}

function listItems(list: PMNode, wa: boolean, marker: (i: number, item: PMNode) => string): string[] {
  const out: string[] = [];
  let i = 0;
  list.forEach((item) => {
    const m = marker(i++, item);
    const inner = blocks(item.content, wa);
    if (inner.length === 0) out.push(m.trimEnd());
    inner.forEach((line, j) => out.push(j === 0 ? m + line : "    " + line));
  });
  return out;
}

const WA_MARKS: Record<string, string> = { bold: "*", italic: "_", strike: "~", code: "`" };
const ORDER = ["bold", "italic", "strike", "code"];

function inline(frag: Fragment, wa: boolean, noBold = false): string {
  let out = "";
  const open: string[] = [];
  let link: { href: string; text: string } | null = null;

  const closeFrom = (idx: number) => {
    if (idx < 0 || idx >= open.length) return;
    const closing = open.splice(idx).reverse();
    // Markers must hug the text: "*bold* " not "*bold *".
    const trailing = out.match(/\s*$/)![0];
    out = out.slice(0, out.length - trailing.length) + closing.map((m) => WA_MARKS[m]).join("") + trailing;
  };

  const flushLink = () => {
    if (link && link.href && link.text.trim() !== link.href && !/^mailto:/.test(link.href)) {
      out += ` (${link.href})`;
    }
    link = null;
  };

  frag.forEach((node) => {
    if (node.type.name === "hardBreak") {
      closeFrom(0);
      flushLink();
      out += "\n";
      return;
    }
    if (!node.isText) {
      out += node.textContent;
      return;
    }
    let text = node.text ?? "";
    const names = node.marks.map((m) => m.type.name);
    const want = wa ? ORDER.filter((n) => names.includes(n) && !(noBold && n === "bold")) : [];

    const href = node.marks.find((m) => m.type.name === "link")?.attrs.href as string | undefined;
    if ((link?.href ?? null) !== (href ?? null)) {
      closeFrom(0);
      flushLink();
    }

    closeFrom(open.findIndex((m) => !want.includes(m)));
    const toOpen = want.filter((m) => !open.includes(m));
    if (toOpen.length && text.trim()) {
      const lead = text.match(/^\s*/)![0];
      out += lead;
      text = text.slice(lead.length);
      out += toOpen.map((m) => WA_MARKS[m]).join("");
      open.push(...toOpen);
    }
    out += text;
    if (href) link = { href, text: (link?.text ?? "") + (node.text ?? "") };
  });

  closeFrom(0);
  flushLink();
  return out;
}
