import type { AnnotationColor } from "./highlight";

/** Content coordinates, independent of page size and margin layout. */
export interface NoteAnchor {
  spineItemId: string;
  startOffset: number;
  endOffset: number;
  textBefore: string;
  textAfter: string;
}

export interface NoteQuote {
  text: string;
  color: AnnotationColor;
}

interface NoteBase {
  id: string;
  bookId: string;
  anchor: NoteAnchor;
  createdAt: number;
  updatedAt: number;
}

/** Notes own their location and quote even after their highlight is deleted. */
export type Note = NoteBase &
  (
    | { kind: "note"; content: string; quote?: NoteQuote; highlightId?: string }
    | { kind: "bookmark" }
  );

export type NoteTarget =
  | { kind: "page"; anchor: NoteAnchor }
  | { kind: "selection"; anchor: NoteAnchor; text: string }
  | {
      kind: "highlight";
      anchor: NoteAnchor;
      highlightId: string;
      quote: NoteQuote;
    };

/** Drafts are local. A compose draft and edits can coexist in the same book. */
export type NoteDraft = {
  id: string;
  bookId: string;
  content: string;
  updatedAt: number;
} & (
  | { purpose: "create"; target: NoteTarget }
  | { purpose: "edit"; noteId: string; originalContent: string }
);
