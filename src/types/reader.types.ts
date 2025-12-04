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

export interface ReaderSettings {
  fontSize: number; // percentage, e.g. 100
  lineHeight: number; // multiplier, e.g. 1.5
  fontFamily: FontFamily;
  theme: ReaderTheme;
  textAlign: "left" | "justify";
}
