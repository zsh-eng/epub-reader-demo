export { parseChapterHtml } from "./parse-html";
export { prepareBlocks, clearPrepareCache } from "./prepare-blocks";
export { layoutPages } from "./layout-pages";
export { layoutTextLines, layoutPreWrapLines } from "./layout-text-lines";
export { headingScale, getBlockSpacing, getLineHeight } from "./spacing";
export { measureCollapsedSpaceWidth, measureSingleLineWidth } from "./measure";
export { usePagination } from "./use-pagination";

export type {
  UsePaginationOptions,
  UsePaginationResult,
  PaginationStatus,
  PaginationCommandHistoryEntry,
  PaginationFontSwitchLatencyTrace,
} from "./use-pagination";

export type {
  ContentAnchor,
  PaginationCommand,
  PaginationEvent,
} from "./engine-types";

export type {
  // Stage 1
  Block,
  TextBlock,
  ImageBlock,
  SpacerBlock,
  PageBreakBlock,
  InlineRun,
  BlockTag,
  // Stage 2
  FontConfig,
  PreparedBlock,
  PreparedTextBlock,
  PreparedImageBlock,
  PreparedSpacerBlock,
  PreparedPageBreakBlock,
  PreparedInlineItem,
  PreparedTextItem,
  PreparedAtomicItem,
  // Stage 3
  LayoutTheme,
  PaginationConfig,
  PaginationResult,
  Page,
  PageSlice,
  TextCursorOffset,
  TextSlice,
  ImageSlice,
  SpacerSlice,
  PageLine,
  PageFragment,
  PaginationDiagnostics,
  PaginationChapterDiagnostics,
} from "./types";
