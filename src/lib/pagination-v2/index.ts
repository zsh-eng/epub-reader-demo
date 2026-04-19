export {
    createPaginationCommandHistoryEntry, MAX_PAGINATION_COMMAND_HISTORY, nextPaginationCommandHistory,
    summarizePaginationCommand
} from "./diagnostics/command-history";
export type { PaginationCommandHistoryEntry } from "./diagnostics/command-history";
export { PaginationTracer } from "./diagnostics/tracer";
export type {
    PaginationFontSwitchLatencyTrace,
    PaginationTracerSnapshot
} from "./diagnostics/tracer";
export { resolveContentAnchorRangeToHighlight } from "./engine/highlight-selection";
export type { ResolvedHighlightSelection } from "./engine/highlight-selection";
export { resolveDomEndpointToContentAnchor } from "./engine/selection-anchors";
export type { PaginationCommand, PaginationEvent } from "./protocol";
export { layoutPages } from "./shared/layout-pages";
export {
    layoutPreWrapLines,
    layoutTextLines
} from "./shared/layout-text-lines";
export {
    measureCollapsedSpaceWidth,
    measureSingleLineWidth
} from "./shared/measure";
export {
    parseChapterHtml,
    parseChapterHtmlWithCanonicalText
} from "./shared/parse-html";
export { clearPrepareCache, prepareBlocks } from "./shared/prepare-blocks";
export { getBlockSpacing, getLineHeight, headingScale } from "./shared/spacing";
export { DEFAULT_SPREAD_CONFIG } from "./types";
export type {
    Block,
    ChapterCanonicalText,
    ContentAnchor,
    FontConfig,
    HighlightMark,
    ImageSlice,
    InlineRun,
    LayoutTheme,
    LinkRef,
    Page,
    PageFragment,
    PageSlice,
    PaginationConfig,
    PaginationStatus,
    PreparedBlock,
    PreparedInlineItem,
    PreparedTextBlock,
    PreparedTextItem,
    ResolvedLeafPage,
    ResolvedSpread,
    SpacerSlice,
    SpreadConfig, SpreadGapReason, SpreadIntent, SpreadSlot,
    TextBlock,
    TextCursorOffset,
    TextRenderMode,
    TextRun,
    TextSlice
} from "./types";
export { usePagination } from "./use-pagination";
export type {
    UsePaginationOptions,
    UsePaginationResult
} from "./use-pagination";
