import type {
  FontConfig,
  LayoutTheme,
  PageSlice,
  TextCursorOffset,
} from "./shared/types";
import type { PaginationCommand } from "./protocol";

// Re-export types that are unchanged from pagination v1
export { areFontConfigsEqual } from "./shared/types";
export type {
  Block,
  BlockTag,
  FontConfig,
  HighlightMark,
  ImageBlock,
  ImageSlice,
  InlineRun,
  LayoutTheme,
  Page,
  PageFragment,
  PageLine,
  PageSlice,
  PaginationChapterDiagnostics,
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
  TextRenderMode,
  TextSlice,
} from "./shared/types";

// ---------------------------------------------------------------------------
// PaginationConfig (relayout-affecting) and SpreadConfig (projection only)
// ---------------------------------------------------------------------------

export interface PaginationConfig {
  fontConfig: FontConfig;
  layoutTheme: LayoutTheme;
  /** Per-leaf-page viewport dimensions. */
  viewport: { width: number; height: number };
}

export interface SpreadConfig {
  columns: 1 | 2 | 3;
  chapterFlow: "continuous" | "align-leftmost";
}

export const DEFAULT_SPREAD_CONFIG: SpreadConfig = {
  columns: 1,
  chapterFlow: "continuous",
};

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
// ResolvedLeafPage / ResolvedSpread — what the hook exposes and events carry.
// All numeric fields are computed on demand by the engine; nothing is cached.
// ---------------------------------------------------------------------------

export interface ResolvedLeafPage {
  currentPage: number;
  totalPages: number;
  currentPageInChapter: number;
  totalPagesInChapter: number;
  chapterIndex: number;
  content: PageSlice[];
}

export type SpreadGapReason = "chapter-boundary" | "end-of-book" | "unloaded";

export type SpreadSlot =
  | {
      kind: "page";
      slotIndex: number;
      page: ResolvedLeafPage;
    }
  | {
      kind: "gap";
      slotIndex: number;
      reason: SpreadGapReason;
    };

export interface ResolvedSpread {
  slots: ReadonlyArray<SpreadSlot>;
  cause: PaginationCommand["type"];
  currentPage: number;
  totalPages: number;
  currentSpread: number;
  totalSpreads: number;
  chapterIndexStart: number | null;
  chapterIndexEnd: number | null;
}

export type PaginationStatus = "idle" | "partial" | "recalculating" | "ready";
