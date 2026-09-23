import type { NoteTarget } from "@/types/note";

/** Color changes may update the same attachment; another passage needs consent. */
export function sameNotePassage(a: NoteTarget, b: NoteTarget): boolean {
  return (
    a.kind !== "page" &&
    b.kind !== "page" &&
    a.anchor.spineItemId === b.anchor.spineItemId &&
    a.anchor.startOffset === b.anchor.startOffset &&
    a.anchor.endOffset === b.anchor.endOffset
  );
}
