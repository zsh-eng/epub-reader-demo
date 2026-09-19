import { expect, it } from "vitest";
import { sameNotePassage } from "@/features/reader/note-target";
import type { NoteTarget } from "@/types/note";

const selection: NoteTarget = {
  kind: "selection",
  text: "Selected passage",
  anchor: {
    spineItemId: "chapter-one",
    startOffset: 10,
    endOffset: 30,
    textBefore: "",
    textAfter: "",
  },
};

it("recognizes a saved highlight as the same passage as its selection", () => {
  expect(
    sameNotePassage(selection, {
      kind: "highlight",
      anchor: selection.anchor,
      highlightId: "highlight-one",
      quote: { text: selection.text, color: "blue" },
    }),
  ).toBe(true);
});

it("keeps detached drafts and different passages separate", () => {
  expect(
    sameNotePassage(selection, { kind: "page", anchor: selection.anchor }),
  ).toBe(false);
  for (const change of [
    { spineItemId: "chapter-two" },
    { startOffset: 11 },
    { endOffset: 31 },
  ]) {
    expect(
      sameNotePassage(selection, {
        ...selection,
        anchor: { ...selection.anchor, ...change },
      }),
    ).toBe(false);
  }
});
