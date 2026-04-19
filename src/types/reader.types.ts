import { type Book } from "@/lib/db";

/**
 * Represents the navigation state for chapter navigation
 */
export interface ChapterNavigationState {
  currentIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  totalChapters: number;
}

/**
 * Represents the state of the highlight toolbar
 */
export interface HighlightState {
  showToolbar: boolean;
  position: { x: number; y: number };
  selection: Selection | null;
}

/**
 * Represents the overall reader state
 */
export interface ReaderState {
  book: Book | null;
  isLoading: boolean;
  chapterContent: string;
  isTOCOpen: boolean;
}

/**
 * Information about the current chapter
 */
export interface ChapterInfo {
  title: string;
  index: number;
  href: string;
  hasNext: boolean;
  hasPrevious: boolean;
}

export const THEME_CLASSES = [
  "light",
  "dark",
  "flexoki-light",
  "flexoki-dark",
] as const;
export type ReaderTheme = (typeof THEME_CLASSES)[number];

export const FONT_CLASSES = [
  "serif",
  "sans-serif",
  "monospace",
  "lora",
  "iowan",
  "garamond",
  "inter",
] as const;
export type FontFamily = (typeof FONT_CLASSES)[number];

export const CONTENT_WIDTH_CLASSES = [
  "compact",
  "narrow",
  "medium",
  "wide",
  "full",
] as const;
export type ContentWidth = (typeof CONTENT_WIDTH_CLASSES)[number];

export const CONTENT_WIDTH_VALUES: Record<ContentWidth, string> = {
  compact: "40rem", // 640px
  narrow: "48rem", // 768px
  medium: "56rem", // 896px
  wide: "64rem", // 1024px
  full: "72rem", // 1152px
};

export const FONT_STACKS: Record<FontFamily, string> = {
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  "sans-serif":
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  monospace:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  lora: '"Lora", serif',
  iowan: '"Iowan Old Style", "Sitka Text", Palatino, "Book Antiqua", serif',
  garamond: '"EB Garamond", "Garamond", serif',
  inter: '"Inter", sans-serif',
};

export const TEXT_ALIGN = {
  left: "left",
  justify: "justify",
  // Uses the custom Knuth-Plass line-breaking path in ReaderV2 while still
  // falling back to CSS justify anywhere we only support native layout.
  justifyKnuthPlass: "justify-knuth-plass",
  center: "center",
  right: "right",
} as const;

export type TextAlign = (typeof TEXT_ALIGN)[keyof typeof TEXT_ALIGN];

export function isJustifiedTextAlign(
  value: TextAlign,
): value is "justify" | "justify-knuth-plass" {
  return value === "justify" || value === "justify-knuth-plass";
}

export function toCssTextAlign(
  value: TextAlign,
): "left" | "center" | "right" | "justify" {
  return value === "justify-knuth-plass" ? "justify" : value;
}

export interface ReaderSettings {
  fontSize: number; // percentage, e.g. 100
  lineHeight: number; // multiplier, e.g. 1.5
  fontFamily: FontFamily;
  theme: ReaderTheme;
  textAlign: TextAlign;
  contentWidth: ContentWidth; // width of the reading area
}

export const EPUB_HIGHLIGHT_CLASS = "epub-highlight";
export const EPUB_HIGHLIGHT_ACTIVE_CLASS = "epub-highlight-active";
export const EPUB_HIGHLIGHT_GROUP_HOVER_CLASS = "epub-highlight-group-hover";
export const EPUB_HIGHLIGHT_DATA_ATTRIBUTE = "data-highlight-id";
export const EPUB_HIGHLIGHT_START_ATTRIBUTE = "data-highlight-start";
export const EPUB_HIGHLIGHT_END_ATTRIBUTE = "data-highlight-end";
export const HIGHLIGHT_TOOLBAR_CLASS = "highlight-toolbar";

export const EPUB_LINK = {
  /** Data attribute name for marking internal EPUB links */
  linkAttribute: "data-epub-link",
  /** Data attribute name for the resolved internal href */
  hrefAttribute: "data-epub-href",
} as const;
