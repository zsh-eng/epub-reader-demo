import type { LayoutCursor, PreparedTextWithSegments } from "@chenglou/pretext";

// ---------------------------------------------------------------------------
// Stage 1: Block types (output of parseChapterHtml)
// ---------------------------------------------------------------------------

export type BlockTag =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "li"
  | "blockquote"
  | "pre"
  | "figcaption";

export interface InlineRun {
  text: string;
  hardBreak?: boolean;
  bold: boolean;
  italic: boolean;
  isCode: boolean;
  isLink: boolean;
}

export interface TextBlock {
  type: "text";
  id: string;
  tag: BlockTag;
  runs: InlineRun[];
}

export interface ImageBlock {
  type: "image";
  id: string;
  src: string;
  alt?: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
}

export interface SpacerBlock {
  type: "spacer";
  id: string;
}

export interface PageBreakBlock {
  type: "page-break";
  id: string;
}

export type Block = TextBlock | ImageBlock | SpacerBlock | PageBreakBlock;

// ---------------------------------------------------------------------------
// Stage 2: FontConfig + PreparedBlock types
// ---------------------------------------------------------------------------

export interface FontConfig {
  bodyFamily: string;
  headingFamily: string;
  codeFamily: string;
  baseSizePx: number;
}

export interface PreparedTextItem {
  kind: "text";
  font: string;
  isLink: boolean;
  isCode: boolean;
  chromeWidth: number;
  prepared: PreparedTextWithSegments;
  rawText: string;
  fullText: string;
  fullWidth: number;
  endCursor: LayoutCursor;
  leadingGap: number;
}

export interface PreparedAtomicItem {
  kind: "atomic";
  width: number;
  height: number;
  leadingGap: number;
  content: { type: "inline-image"; src: string; alt?: string };
}

export type PreparedInlineItem = PreparedTextItem | PreparedAtomicItem;

export interface PreparedTextBlock {
  type: "text";
  id: string;
  tag: string;
  items: PreparedInlineItem[];
  containsNewlines: boolean;
}

export interface PreparedImageBlock {
  type: "image";
  id: string;
  src: string;
  alt?: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
}

export interface PreparedSpacerBlock {
  type: "spacer";
  id: string;
}

export interface PreparedPageBreakBlock {
  type: "page-break";
  id: string;
}

export type PreparedBlock =
  | PreparedTextBlock
  | PreparedImageBlock
  | PreparedSpacerBlock
  | PreparedPageBreakBlock;

// ---------------------------------------------------------------------------
// Stage 3: LayoutTheme + output types
// ---------------------------------------------------------------------------

export interface LayoutTheme {
  lineHeightFactor: number;
  paragraphSpacingFactor: number;
  headingSpaceAbove: number;
  headingSpaceBelow: number;
  textAlign: "left" | "center" | "right" | "justify";
  baseFontSizePx: number;
}

export interface PaginationConfig {
  fontConfig: FontConfig;
  layoutTheme: LayoutTheme;
  viewport: { width: number; height: number };
}

export interface PageFragment {
  text: string;
  font: string;
  leadingGap: number;
  isLink: boolean;
  isCode: boolean;
}

export interface TextCursorOffset {
  itemIndex: number;
  segmentIndex: number;
  graphemeIndex: number;
}

export interface PageLine {
  fragments: PageFragment[];
  startOffset?: TextCursorOffset;
  endOffset?: TextCursorOffset;
  isLastInBlock: boolean;
}

export interface TextSlice {
  type: "text";
  blockId: string;
  lineHeight: number;
  textAlign: "left" | "center" | "right" | "justify";
  lines: PageLine[];
}

export interface ImageSlice {
  type: "image";
  blockId: string;
  src: string;
  alt?: string;
  width: number;
  height: number;
}

export interface SpacerSlice {
  type: "spacer";
  blockId: string;
  height: number;
}

export type PageSlice = TextSlice | ImageSlice | SpacerSlice;

export interface Page {
  index: number;
  slices: PageSlice[];
}

export interface PaginationDiagnostics {
  blockCount: number;
  lineCount: number;
  computeMs: number;
  stage1ParseMs?: number;
  stage2PrepareMs?: number;
  stage3LayoutMs?: number;
  totalMs?: number;
  chapterCount?: number;
  chapterTimings?: PaginationChapterDiagnostics[];
}

export interface PaginationChapterDiagnostics {
  chapterIndex: number;
  blockCount: number;
  lineCount: number;
  pageCount: number;
  stage1ParseMs?: number;
  stage2PrepareMs?: number;
  stage3LayoutMs?: number;
  chapterLoadMs?: number;
  totalMs?: number;
}

export interface PaginationResult {
  pages: Page[];
  diagnostics: PaginationDiagnostics;
}

export function areFontConfigsEqual(
  a: FontConfig,
  b: FontConfig,
): boolean {
  return (
    a.bodyFamily === b.bodyFamily &&
    a.headingFamily === b.headingFamily &&
    a.codeFamily === b.codeFamily &&
    a.baseSizePx === b.baseSizePx
  );
}
