/**
 * Export & backup:
 *  - backup (.json): every note, notebook and picture; can be restored with "Restore from backup"
 *  - Markdown (.md): all notes as readable text, one section per note, grouped by notebook
 */
import type { JSONContent } from "@tiptap/core";
import type { AppData, Note, Notebook } from "../types";
import { addImageData, imageIds, localImage } from "./images";

interface BackupFile {
  app: "notewell";
  kind: "backup";
  version: 1;
  exportedAt: number;
  notes: Note[];
  notebooks: Notebook[];
  defaultNotebookId: string;
  images: Record<string, string>;
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function makeBackup(d: AppData): Promise<{ name: string; content: string }> {
  const images: Record<string, string> = {};
  for (const n of d.notes) {
    for (const id of imageIds(n.content)) {
      if (!(id in images)) {
        const data = await localImage(id);
        if (data) images[id] = data;
      }
    }
  }
  const file: BackupFile = {
    app: "notewell",
    kind: "backup",
    version: 1,
    exportedAt: Date.now(),
    notes: d.notes,
    notebooks: d.notebooks,
    defaultNotebookId: d.defaultNotebookId,
    images,
  };
  return { name: `Notewell backup ${stamp()}.json`, content: JSON.stringify(file) };
}

/**
 * Adds a backup's notes to the current data: notes that aren't here are added, notes that are older
 * here are replaced by the backup's version; nothing is deleted.
 */
export async function restoreBackup(d: AppData, text: string): Promise<{ data: AppData; added: number; updated: number }> {
  let file: BackupFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a Notewell backup.");
  }
  // A daily backup (desktop, backups/notewell-YYYY-MM-DD.json) is the plain notes file: same notes and
  // notebooks, no pictures (those stay in the data folder anyway).
  const isDaily = file && (file as unknown as AppData).version === 1 && Array.isArray(file.notes) && Array.isArray(file.notebooks);
  if ((file?.app !== "notewell" && !isDaily) || !Array.isArray(file.notes)) throw new Error("This file isn't a Notewell backup.");
  for (const [id, data] of Object.entries(file.images ?? {})) {
    if (!(await localImage(id))) await addImageData(data, id);
  }
  const now = Date.now();
  const notebooks = [...d.notebooks];
  for (const nb of file.notebooks ?? []) if (!notebooks.some((x) => x.id === nb.id)) notebooks.push(nb);
  const nbIds = new Set(notebooks.map((nb) => nb.id));
  const byId = new Map(d.notes.map((n) => [n.id, n]));
  let added = 0;
  let updated = 0;
  for (const raw of file.notes) {
    const n = nbIds.has(raw.notebookId) ? raw : { ...raw, notebookId: d.defaultNotebookId };
    const local = byId.get(n.id);
    if (!local) {
      byId.set(n.id, n);
      added++;
    } else if (n.updatedAt > local.updatedAt) {
      byId.set(n.id, n);
      updated++;
    }
  }
  const notebooksChanged = notebooks.length !== d.notebooks.length;
  return {
    data: { ...d, notes: [...byId.values()], notebooks, ...(notebooksChanged ? { notebooksUpdatedAt: now } : {}) },
    added,
    updated,
  };
}

// ---- Markdown ----

function marks(text: string, m: JSONContent["marks"]): string {
  let t = text;
  for (const mark of m ?? []) {
    if (mark.type === "bold") t = `**${t}**`;
    else if (mark.type === "italic") t = `*${t}*`;
    else if (mark.type === "strike") t = `~~${t}~~`;
    else if (mark.type === "code") t = "`" + t + "`";
    else if (mark.type === "link") t = `[${t}](${mark.attrs?.href ?? ""})`;
  }
  return t;
}

function inline(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((n) =>
      n.type === "text"
        ? marks(n.text ?? "", n.marks)
        : n.type === "hardBreak"
          ? "  \n"
          : n.type === "noteLink"
            ? `[[${n.attrs?.title ?? ""}]]`
            : inline(n.content),
    )
    .join("");
}

function block(n: JSONContent, indent = ""): string[] {
  switch (n.type) {
    case "paragraph":
      return [indent + inline(n.content), ""];
    case "heading":
      return [`${"#".repeat((n.attrs?.level ?? 1) + 1)} ${inline(n.content)}`, ""];
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const out: string[] = [];
      (n.content ?? []).forEach((item, i) => {
        const marker = n.type === "orderedList" ? `${i + 1}.` : n.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}]` : "-";
        const [first, ...rest] = item.content ?? [];
        out.push(`${indent}${marker} ${first ? inline(first.content) : ""}`);
        for (const r of rest) out.push(...block(r, indent + "  ").filter((l) => l !== ""));
      });
      return [...out, ""];
    }
    case "blockquote":
      return [...(n.content ?? []).flatMap((c) => block(c)).map((l) => (l ? `> ${l}` : ">")), ""];
    case "codeBlock":
      return ["```", inline(n.content), "```", ""];
    case "horizontalRule":
      return ["---", ""];
    case "linkPreview":
    case "embed":
      return [`[${n.attrs?.title || n.attrs?.url}](${n.attrs?.url})`, ""];
    case "noteImage":
      return ["*(picture)*", ""];
    default:
      return (n.content ?? []).flatMap((c) => block(c, indent));
  }
}

export function makeMarkdown(d: AppData): { name: string; content: string } {
  const out: string[] = [`# Notewell export (${stamp()})`, ""];
  const live = d.notes.filter((n) => !n.trashedAt);
  for (const nb of [...d.notebooks].sort((a, b) => a.name.localeCompare(b.name))) {
    const notes = live.filter((n) => n.notebookId === nb.id).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!notes.length) continue;
    out.push(`# ${nb.name}`, "");
    for (const n of notes) {
      out.push(`## ${n.title.trim() || "Untitled"}`, "");
      const meta = [`Updated ${new Date(n.updatedAt).toLocaleString()}`, ...(n.tags.length ? [`Tags: ${n.tags.join(", ")}`] : [])];
      out.push(`*${meta.join(" · ")}*`, "");
      out.push(...(n.content?.content ?? []).flatMap((c) => block(c)));
      out.push("---", "");
    }
  }
  return { name: `Notewell notes ${stamp()}.md`, content: out.join("\n").replace(/\n{3,}/g, "\n\n") };
}
