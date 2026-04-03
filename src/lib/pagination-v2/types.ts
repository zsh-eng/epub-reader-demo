import type { PageSlice, TextCursorOffset } from "../pagination/types";

// Re-export types that are unchanged from pagination v1
export type {
  Block,
  BlockTag,
  FontConfig,
  ImageBlock,
  ImageSlice,
  InlineRun,
  LayoutTheme,
  Page,
  PageFragment,
  PageLine,
  PageSlice,
  PaginationChapterDiagnostics,
  PaginationConfig,
  PaginationDiagnostics,
  PaginationResult,
  PreparedBlock,
  PreparedImageBlock,
  PreparedInlineItem,
  PreparedSpacerBlock,
  PreparedTextBlock,
  PreparedTextItem,
  SpacerBlock,
  SpacerSlice,
  TextBlock,
  TextCursorOffset,
  TextSlice,
} from "../pagination/types";
export { areFontConfigsEqual } from "../pagination/types";

// ---------------------------------------------------------------------------
// ContentAnchor — discriminated union replacing the flat interface in v1.
// A "text" anchor includes a precise cursor position within the text block;
// a "block" anchor pins to the start of the block (used for images, spacers).
// ---------------------------------------------------------------------------

export type ContentAnchor =
  | {
      type: "text";
      chapterIndex: number;
      blockId: string;
      offset: TextCursorOffset;
    }
  | {
      type: "block";
      chapterIndex: number;
      blockId: string;
    };

// ---------------------------------------------------------------------------
// ResolvedPage — what the hook exposes and what events carry.
// All numeric fields are computed on demand by the engine; nothing is cached.
// ---------------------------------------------------------------------------

export interface ResolvedPage {
  currentPage: number;
  totalPages: number;
  currentPageInChapter: number;
  totalPagesInChapter: number;
  chapterIndex: number;
  content: PageSlice[];
}

export type PaginationStatus = "idle" | "partial" | "recalculating" | "ready";
