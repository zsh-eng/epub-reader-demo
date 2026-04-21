import type { Book } from "@/lib/db";
import type {
    Block,
    ChapterCanonicalText,
    PaginationConfig,
    PaginationStatus,
    ResolvedSpread,
    SpreadConfig,
} from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import type { ReaderSettings } from "@/types/reader.types";
import { useMemo } from "react";
import type { ChapterEntry } from "../types";
import { useReaderHighlightActions } from "./use-reader-highlight-actions";
import {
    useReaderNavigationActions,
    type ReaderNavigationActions,
} from "./use-reader-navigation-actions";
import { useReaderCore } from "./use-reader-core";

export interface UseReaderSessionOptions {
  bookId?: string;
  viewport: { width: number; height: number };
  spreadColumns: 1 | 2 | 3;
  paragraphSpacingFactor?: number;
}

export type ReaderSessionStatus = "loading" | "ready" | "not-found";

export interface ReaderSessionChapterAccess {
  getBlocks: (chapterIndex: number) => Block[] | null;
  getCanonicalText: (chapterIndex: number) => ChapterCanonicalText | null;
}

export interface ReaderSessionChaptersState {
  /**
   * Spine-backed chapter metadata used by reader UI like chapter navigation and
   * labels. Similar to table-of-contents entries, but aligned to the exact
   * chapter sources loaded into pagination.
   */
  entries: ChapterEntry[];
}

export interface ReaderSessionNavigationState {
  currentPage: number;
  totalPages: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  currentChapterIndex: number;
  currentTitleChapterIndex: number | null;
  chapterStartPages: (number | null)[];
}

export interface ReaderSessionPaginationState {
  spread: ResolvedSpread | null;
  status: PaginationStatus;
  spreadConfig: SpreadConfig;
  paginationConfig: PaginationConfig;
}

export interface ReaderSessionState {
  status: ReaderSessionStatus;
  book: Book | null;
  settings: ReaderSettings;
  highlights: Highlight[];
  chapters: ReaderSessionChaptersState;
  pagination: ReaderSessionPaginationState;
  navigation: ReaderSessionNavigationState;
}

export interface ReaderSessionResources {
  chapterAccess: ReaderSessionChapterAccess;
}

export interface ReaderSessionActions {
  updateSettings: (patch: Partial<ReaderSettings>) => void;
  nextSpread: ReaderNavigationActions["nextSpread"];
  prevSpread: ReaderNavigationActions["prevSpread"];
  previewPage: ReaderNavigationActions["previewPage"];
  commitPage: ReaderNavigationActions["commitPage"];
  goToChapter: ReaderNavigationActions["goToChapter"];
  goToPreviousChapter: ReaderNavigationActions["goToPreviousChapter"];
  goToNextChapter: ReaderNavigationActions["goToNextChapter"];
  openInternalHref: ReaderNavigationActions["openInternalHref"];
  createHighlight: (highlight: Highlight) => void;
}

export interface UseReaderSessionResult {
  /**
   * State for rendering in the UI.
   */
  state: ReaderSessionState;
  /**
   * Stable helper accessors.
   * Required for setting up certain advanced logic like handling highlights.
   */
  resources: ReaderSessionResources;
  /**
   * Actions against the reader, such as navigating between pages.
   */
  actions: ReaderSessionActions;
}

/**
 * Facade around the current Reader core wiring.
 *
 * The goal is to expose a "reading session" API to UI components rather than
 * the raw mix of pagination internals, chapter source plumbing, and derived
 * values. This keeps the UI focused on rendering and user interaction while we
 * continue splitting the underlying modules behind this boundary.
 */
export function useReaderSession(
  options: UseReaderSessionOptions,
): UseReaderSessionResult {
  const core = useReaderCore(options);
  const { createHighlight } = useReaderHighlightActions(options.bookId);

  const navigationActions = useReaderNavigationActions({
    pagination: core.pagination,
    currentChapterIndex: core.currentChapterIndex,
    chapterEntries: core.chapterEntries,
  });

  const chapterAccess = useMemo<ReaderSessionChapterAccess>(
    () => ({
      getBlocks: core.getChapterBlocks,
      getCanonicalText: core.getChapterCanonicalText,
    }),
    [core.getChapterBlocks, core.getChapterCanonicalText],
  );

  const state = useMemo<ReaderSessionState>(() => {
    const status: ReaderSessionStatus = core.isBookLoading
      ? "loading"
      : !options.bookId || !core.book
        ? "not-found"
        : "ready";

    return {
      status,
      book: core.book,
      settings: core.settings,
      highlights: core.bookHighlights,
      chapters: {
        entries: core.chapterEntries,
      },
      pagination: {
        spread: core.pagination.spread,
        status: core.pagination.status,
        spreadConfig: core.spreadConfig,
        paginationConfig: core.paginationConfig,
      },
      navigation: {
        currentPage: core.currentPage,
        totalPages: core.totalPages,
        canGoPrev: core.currentPage > 1,
        canGoNext: !(
          core.pagination.status === "ready" &&
          core.totalPages > 0 &&
          core.currentPage >= core.totalPages
        ),
        currentChapterIndex: core.currentChapterIndex,
        currentTitleChapterIndex: core.currentTitleChapterIndex,
        chapterStartPages: core.chapterStartPages,
      },
    };
  }, [
    core.book,
    core.bookHighlights,
    core.chapterEntries,
    core.chapterStartPages,
    core.currentChapterIndex,
    core.currentPage,
    core.currentTitleChapterIndex,
    core.isBookLoading,
    core.pagination.spread,
    core.pagination.status,
    core.paginationConfig,
    core.settings,
    core.spreadConfig,
    core.totalPages,
    options.bookId,
  ]);

  const resources = useMemo<ReaderSessionResources>(
    () => ({
      chapterAccess,
    }),
    [chapterAccess],
  );

  const actions = useMemo<ReaderSessionActions>(
    () => ({
      updateSettings: core.onUpdateSettings,
      ...navigationActions,
      createHighlight,
    }),
    [core.onUpdateSettings, createHighlight, navigationActions],
  );

  return {
    state,
    resources,
    actions,
  };
}
