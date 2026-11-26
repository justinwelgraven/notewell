import { describe, expect, it } from "vitest";
import type { AppData, Note } from "../types";
import { deleteTag, removeStack, renameStack, renameTag, setNotebookStack, stacksOf } from "./organize";

const text = (t: string, marks?: { type: string }[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const note = (id: string, tags: string[], body: string): Note => ({
  id,
  title: id,
  content: { type: "doc", content: [{ type: "paragraph", content: [text(body)] }] },
  text: body,
  thumb: null,
  notebookId: "nb",
  tags,
  starred: false,
  trashedAt: null,
  createdAt: 1,
  updatedAt: 1,
});
const data = (notes: Note[]): AppData => ({
  version: 1,
  notes,
  notebooks: [
    { id: "a", name: "Work", createdAt: 1 },
    { id: "b", name: "Home", createdAt: 1 },
  ],
  defaultNotebookId: "a",
});
const bodyOf = (n: Note) => n.content!.content![0].content![0].text;

describe("tags", () => {
  it("rename changes the tag and the #hashtag in the text", () => {
    const d = renameTag(data([note("1", ["food"], "buy #food and #foodie stuff")]), "food", "groceries");
    expect(d.notes[0].tags).toEqual(["groceries"]);
    expect(bodyOf(d.notes[0])).toBe("buy #groceries and #foodie stuff");
    expect(d.notes[0].text).toBe("buy #groceries and #foodie stuff");
    expect(d.notes[0].updatedAt).toBeGreaterThan(1);
  });

  it("rename into an existing tag merges them", () => {
    const d = renameTag(data([note("1", ["Food", "shop"], "x")]), "food", "shop");
    expect(d.notes[0].tags).toEqual(["shop"]);
  });

  it("delete removes the tag and keeps the word without #", () => {
    const d = deleteTag(data([note("1", ["food", "x"], "#Food is good")]), "food");
    expect(d.notes[0].tags).toEqual(["x"]);
    expect(bodyOf(d.notes[0])).toBe("Food is good");
  });

  it("notes without the tag are left alone", () => {
    const n = note("1", ["other"], "nothing here");
    expect(renameTag(data([n]), "food", "x").notes[0]).toBe(n);
  });

  it("hashtags inside links and code are not touched", () => {
    const n = note("1", ["food"], "");
    n.content = { type: "doc", content: [{ type: "paragraph", content: [text("#food", [{ type: "code" }])] }] };
    expect(bodyOf(renameTag(data([n]), "food", "x").notes[0])).toBe("#food");
  });
});

describe("notebook stacks", () => {
  it("put notebooks in a stack, rename it, remove it", () => {
    let d = setNotebookStack(data([]), "a", "Projects");
    d = setNotebookStack(d, "b", "Projects");
    expect(stacksOf(d)).toEqual(["Projects"]);
    expect(d.notebooksUpdatedAt).toBeGreaterThan(0); // syncs
    d = renameStack(d, "Projects", "Areas");
    expect(d.notebooks.map((n) => n.stack)).toEqual(["Areas", "Areas"]);
    d = removeStack(d, "Areas");
    expect(stacksOf(d)).toEqual([]);
    expect(d.notebooks).toHaveLength(2);
  });

  it("taking a notebook out of a stack", () => {
    const d = setNotebookStack(setNotebookStack(data([]), "a", "S"), "a", null);
    expect(d.notebooks[0].stack).toBeUndefined();
  });
});
