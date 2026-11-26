/**
 * Sync rules: what happens when Dropbox sends a change. Run with `npm test`
 * (also runs on GitHub before every release / web publish).
 */
import { describe, expect, it } from "vitest";
import type { AppData, Note } from "../types";
import { applyRemote, dedupeStarterNotebooks, mergeNotebooks, pendingNotes, removeNotes } from "./merge";
import { mergeNoteEdits } from "./threeWay";

const P = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const IMG = (id: string) => ({ type: "noteImage", attrs: { id, size: "full" } });
const TASK = (t: string, checked: boolean) => ({ type: "taskItem", attrs: { checked }, content: [P(t)] });

function note(blocks: object[], extra: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "T",
    content: { type: "doc", content: blocks },
    text: "",
    thumb: null,
    notebookId: "nb",
    tags: [],
    starred: false,
    trashedAt: null,
    createdAt: 1,
    updatedAt: 10,
    ...extra,
  };
}

function data(notes: Note[], synced: Record<string, { rev: string; at: number }> = {}): AppData {
  return {
    version: 1,
    notebooks: [{ id: "nb", name: "Notebook", createdAt: 1 }],
    defaultNotebookId: "nb",
    notes,
    sync: { cursor: "c1", notes: synced, deleted: [], notebooksRev: "nbrev", notebooksAt: 0 },
  };
}

/** Body as short labels: paragraph text, IMG:<id>, or a checklist like "[x]milk,[ ]eggs". */
function body(n: Note | null): string[] | "CONFLICT" {
  if (!n) return "CONFLICT";
  return (n.content?.content ?? []).map((b: any) =>
    b.type === "paragraph"
      ? b.content?.[0]?.text ?? ""
      : b.type === "noteImage"
        ? `IMG:${b.attrs.id}`
        : b.type === "taskList"
          ? b.content.map((i: any) => `${i.attrs.checked ? "[x]" : "[ ]"}${i.content[0].content[0].text}`).join(",")
          : b.type,
  );
}

const base = note([P("one"), IMG("x"), P("two"), IMG("y"), P("three")]);

describe("merging a note edited on two devices", () => {
  it("each device deleted a different picture", () => {
    const a = note([P("one"), P("two"), IMG("y"), P("three")], { updatedAt: 20 });
    const b = note([P("one"), IMG("x"), P("two"), P("three")], { updatedAt: 30 });
    expect(body(mergeNoteEdits(base, a, b))).toEqual(["one", "two", "three"]);
  });

  it("both devices deleted the same picture", () => {
    const a = note([P("one"), P("two"), IMG("y"), P("three")]);
    expect(body(mergeNoteEdits(base, a, { ...a, updatedAt: 30 }))).toEqual(["one", "two", "IMG:y", "three"]);
  });

  it("a picture deleted on one device, text edited on the other", () => {
    const a = note([P("one"), P("two"), IMG("y"), P("three")]);
    const b = note([P("one"), IMG("x"), P("two"), IMG("y"), P("three!")]);
    expect(body(mergeNoteEdits(base, a, b))).toEqual(["one", "two", "IMG:y", "three!"]);
  });

  it("paragraphs added at different places", () => {
    const a = note([P("zero"), ...base.content!.content!]);
    const b = note([...base.content!.content!, P("four")]);
    expect(body(mergeNoteEdits(base, a, b))).toEqual(["zero", "one", "IMG:x", "two", "IMG:y", "three", "four"]);
  });

  it("the same paragraph changed differently is a conflict", () => {
    const a = note([P("ONE"), IMG("x"), P("two"), IMG("y"), P("three")]);
    const b = note([P("one?"), IMG("x"), P("two"), IMG("y"), P("three")]);
    expect(mergeNoteEdits(base, a, b)).toBeNull();
  });

  it("different checklist items ticked", () => {
    const list = (items: object[]) => note([{ type: "taskList", content: items }]);
    const b0 = list([TASK("milk", false), TASK("eggs", false)]);
    const m = mergeNoteEdits(b0, list([TASK("milk", true), TASK("eggs", false)]), list([TASK("milk", false), TASK("eggs", true)]));
    expect(body(m)).toEqual(["[x]milk,[x]eggs"]);
  });

  it("a checklist item ticked on one device, an item added on the other", () => {
    const list = (items: object[]) => note([{ type: "taskList", content: items }]);
    const b0 = list([TASK("milk", false), TASK("eggs", false)]);
    const m = mergeNoteEdits(b0, list([TASK("milk", true), TASK("eggs", false)]), list([TASK("milk", false), TASK("eggs", false), TASK("bread", false)]));
    expect(body(m)).toEqual(["[x]milk,[ ]eggs,[ ]bread"]);
  });

  it("title on one device, body on the other; tags from both", () => {
    const a = note(base.content!.content!, { title: "New title", tags: ["a", "b"] });
    const b = note([P("one"), P("two"), IMG("y"), P("three")], { tags: ["c"] });
    const m = mergeNoteEdits({ ...base, tags: ["a"] }, a, b)!;
    expect(m.title).toBe("New title");
    expect(body(m)).toEqual(["one", "two", "IMG:y", "three"]);
    expect(m.tags.sort()).toEqual(["b", "c"]); // "a" was removed on one device
    expect(m.text.split("\n").filter(Boolean)).toEqual(["one", "two", "three"]); // list/search text follows the merge
  });

  it("the merged note is newer than both versions", () => {
    const a = note([P("one"), P("two"), IMG("y"), P("three")], { updatedAt: 20 });
    const b = note([P("one"), IMG("x"), P("two"), P("three")], { updatedAt: 30 });
    expect(mergeNoteEdits(base, a, b)!.updatedAt).toBeGreaterThan(30);
  });

  it("pinned on one device, starred on the other", () => {
    const m = mergeNoteEdits(base, { ...base, pinned: true }, { ...base, starred: true })!;
    expect([m.pinned, m.starred]).toEqual([true, true]);
  });
});

describe("applying changes from Dropbox", () => {
  const remoteNote = (blocks: object[], updatedAt = 30) => note(blocks, { updatedAt });

  it("a new note from another device is added", () => {
    const r = applyRemote(data([]), [{ kind: "note", id: "n1", rev: "r1", note: base }], "c2", () => "x");
    expect(r.data.notes).toHaveLength(1);
    expect(r.data.sync!.cursor).toBe("c2");
    expect(pendingNotes(r.data)).toHaveLength(0);
  });

  it("a note changed only elsewhere is replaced", () => {
    const d = data([base], { n1: { rev: "r1", at: 10 } });
    const r = applyRemote(d, [{ kind: "note", id: "n1", rev: "r2", note: remoteNote([P("new")]) }], "c2", () => "x");
    expect(body(r.data.notes[0])).toEqual(["new"]);
    expect(r.touched).toEqual(["n1"]);
  });

  it("edited on both devices in different places: merged, no conflicted copy, uploaded again", () => {
    const local = note([P("one"), P("two"), IMG("y"), P("three")], { updatedAt: 20 });
    const d = data([local], { n1: { rev: "r1", at: 10 } });
    const r = applyRemote(d, [{ kind: "note", id: "n1", rev: "r2", note: remoteNote([P("one"), IMG("x"), P("two"), P("three")]) }], "c2", () => "copy", { n1: base });
    expect(r.data.notes).toHaveLength(1);
    expect(body(r.data.notes[0])).toEqual(["one", "two", "three"]);
    expect(pendingNotes(r.data).map((n) => n.id)).toEqual(["n1"]);
  });

  it("edited on both devices in the same place: a conflicted copy keeps both", () => {
    const local = note([P("LOCAL"), IMG("x"), P("two"), IMG("y"), P("three")], { updatedAt: 20 });
    const d = data([local], { n1: { rev: "r1", at: 10 } });
    const r = applyRemote(d, [{ kind: "note", id: "n1", rev: "r2", note: remoteNote([P("REMOTE"), IMG("x"), P("two"), IMG("y"), P("three")]) }], "c2", () => "copy", { n1: base });
    expect(r.data.notes).toHaveLength(2);
    expect(r.data.notes.some((n) => n.title.includes("conflicted copy"))).toBe(true);
  });

  it("without the earlier version, both-sides edits still keep both (conflicted copy)", () => {
    const local = note([P("LOCAL")], { updatedAt: 20 });
    const d = data([local], { n1: { rev: "r1", at: 10 } });
    const r = applyRemote(d, [{ kind: "note", id: "n1", rev: "r2", note: remoteNote([P("REMOTE")]) }], "c2", () => "copy");
    expect(r.data.notes).toHaveLength(2);
  });

  it("a delete from elsewhere removes an unchanged note but keeps one edited here", () => {
    const d = data([base, note([P("edited")], { id: "n2", updatedAt: 99 })], { n1: { rev: "r1", at: 10 }, n2: { rev: "r1", at: 10 } });
    const r = applyRemote(d, [{ kind: "delete", id: "n1" }, { kind: "delete", id: "n2" }], "c2", () => "x");
    expect(r.data.notes.map((n) => n.id)).toEqual(["n2"]);
  });

  it("clock differences don't matter: only an exact match counts as synced", () => {
    const d = data([note([P("x")], { updatedAt: 5 })], { n1: { rev: "r1", at: 10 } }); // older clock, but different
    expect(pendingNotes(d)).toHaveLength(1);
  });

  it("deleting a synced note queues the delete for Dropbox", () => {
    const d = removeNotes(data([base], { n1: { rev: "r1", at: 10 } }), ["n1"]);
    expect(d.notes).toHaveLength(0);
    expect(d.sync!.deleted).toEqual(["n1"]);
  });
});

describe("notebooks", () => {
  it("duplicate starter notebooks are merged into the oldest", () => {
    const d: AppData = {
      ...data([note([], { notebookId: "b" })]),
      notebooks: [
        { id: "a", name: "First Notebook", createdAt: 1 },
        { id: "b", name: "First Notebook", createdAt: 2 },
      ],
      defaultNotebookId: "b",
    };
    const r = dedupeStarterNotebooks(d);
    expect(r.notebooks.map((n) => n.id)).toEqual(["a"]);
    expect(r.notes[0].notebookId).toBe("a");
    expect(r.defaultNotebookId).toBe("a");
  });

  it("a notebook deleted on another device disappears here and its notes move", () => {
    const d: AppData = { ...data([note([], { notebookId: "gone" })]), notebooks: [{ id: "nb", name: "A", createdAt: 1 }, { id: "gone", name: "B", createdAt: 2 }] };
    const r = mergeNotebooks(d, { notebooks: [{ id: "nb", name: "A", createdAt: 1 }], deleted: ["gone"], defaultNotebookId: "nb", updatedAt: 5 });
    expect(r.notebooks.map((n) => n.id)).toEqual(["nb"]);
    expect(r.notes[0].notebookId).toBe("nb");
  });
});
