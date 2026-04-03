export { layoutPages } from "./layout-pages";
export { layoutPreWrapLines, layoutTextLines } from "./layout-text-lines";
export { measureCollapsedSpaceWidth, measureSingleLineWidth } from "./measure";
export { parseChapterHtml } from "./parse-html";
export { clearPrepareCache, prepareBlocks } from "./prepare-blocks";
export { getBlockSpacing, getLineHeight, headingScale } from "./spacing";
export { usePagination } from "./use-pagination";

export type { PaginationCommandHistoryEntry } from "./command-history";
export { PaginationTracer } from "./pagination-tracer";
export type {
  PaginationFontSwitchLatencyTrace,
  PaginationTracerSnapshot,
} from "./pagination-tracer";
export type {
  PaginationStatus,
  UsePaginationOptions,
  UsePaginationResult,
} from "./use-pagination";

export type {
  ContentAnchor,
  PaginationCommand,
  PaginationEvent,
} from "./engine-types";

export type {
  // Stage 1
  Block,
  BlockTag,
  // Stage 2
  FontConfig,
  ImageBlock,
  ImageSlice,
  InlineRun,
  // Stage 3
  LayoutTheme,
  Page,
  PageBreakBlock,
  PageFragment,
  PageLine,
  PageSlice,
  PaginationChapterDiagnostics,
  PaginationConfig,
  PaginationDiagnostics,
  PaginationResult,
  PreparedAtomicItem,
  PreparedBlock,
  PreparedImageBlock,
  PreparedInlineItem,
  PreparedPageBreakBlock,
  PreparedSpacerBlock,
  PreparedTextBlock,
  PreparedTextItem,
  SpacerBlock,
  SpacerSlice,
  TextBlock,
  TextCursorOffset,
  TextSlice,
} from "./types";
