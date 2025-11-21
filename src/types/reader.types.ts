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

export type ReaderTheme = 'light' | 'dark' | 'sepia' | 'flexoki-light' | 'flexoki-dark';
export type FontFamily = 'serif' | 'sans-serif' | 'monospace';

export interface ReaderSettings {
  fontSize: number; // percentage, e.g. 100
  lineHeight: number; // multiplier, e.g. 1.5
  fontFamily: FontFamily;
  theme: ReaderTheme;
  textAlign: 'left' | 'justify';
}
