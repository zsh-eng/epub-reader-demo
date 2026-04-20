import { useAddHighlightMutation } from "@/hooks/use-highlights-query";
import { splitHrefFragment } from "@/lib/epub-resource-utils";
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
import { useCallback, useMemo } from "react";
import { resolvePaginatedLinkTarget } from "../link-navigation";
import type { ChapterEntry } from "../types";
import { useReaderV2Core } from "./use-reader-v2-core";

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
  deferredImageCache: Map<string, string>;
}

export interface ReaderSessionActions {
  updateSettings: (patch: Partial<ReaderSettings>) => void;
  nextSpread: () => void;
  prevSpread: () => void;
  previewPage: (page: number) => void;
  commitPage: (page: number) => void;
  goToChapter: (chapterIndex: number) => void;
  goToPreviousChapter: () => void;
  goToNextChapter: () => void;
  openInternalHref: (href: string) => boolean;
  createHighlight: (highlight: Highlight) => void;
}

export interface UseReaderSessionResult {
  state: ReaderSessionState;
  resources: ReaderSessionResources;
  actions: ReaderSessionActions;
}

/**
 * Facade around the current Reader V2 core wiring.
 *
 * The goal is to expose a "reading session" API to UI components rather than
 * the raw mix of pagination internals, chapter source plumbing, and derived
 * values. This keeps the UI focused on rendering and user interaction while we
 * continue splitting the underlying modules behind this boundary.
 */
export function useReaderSession(
  options: UseReaderSessionOptions,
): UseReaderSessionResult {
  const core = useReaderV2Core(options);
  const addHighlightMutation = useAddHighlightMutation(options.bookId);

  const chapterIndexByHrefPath = useMemo(() => {
    const hrefMap = new Map<string, number>();
    for (const chapter of core.chapterEntries) {
      hrefMap.set(splitHrefFragment(chapter.href).path, chapter.index);
    }
    return hrefMap;
  }, [core.chapterEntries]);

  const resolveHref = useCallback(
    (href: string) => resolvePaginatedLinkTarget(href, chapterIndexByHrefPath),
    [chapterIndexByHrefPath],
  );

  const nextSpread = useCallback(() => {
    core.pagination.nextSpread();
  }, [core.pagination.nextSpread]);

  const prevSpread = useCallback(() => {
    core.pagination.prevSpread();
  }, [core.pagination.prevSpread]);

  const previewPage = useCallback(
    (page: number) => {
      core.pagination.goToPage(page, {
        intent: { kind: "preview", source: "scrubber" },
      });
    },
    [core.pagination.goToPage],
  );

  const commitPage = useCallback(
    (page: number) => {
      core.pagination.goToPage(page, {
        intent: { kind: "jump", source: "scrubber" },
      });
    },
    [core.pagination.goToPage],
  );

  const goToChapter = useCallback(
    (chapterIndex: number) => {
      core.pagination.goToChapter(chapterIndex, {
        intent: { kind: "jump", source: "chapter" },
      });
    },
    [core.pagination.goToChapter],
  );

  const goToPreviousChapter = useCallback(() => {
    if (core.currentChapterIndex <= 0) return;
    core.pagination.goToChapter(core.currentChapterIndex - 1, {
      intent: { kind: "jump", source: "chapter" },
    });
  }, [core.currentChapterIndex, core.pagination.goToChapter]);

  const goToNextChapter = useCallback(() => {
    if (core.currentChapterIndex >= core.chapterEntries.length - 1) return;
    core.pagination.goToChapter(core.currentChapterIndex + 1, {
      intent: { kind: "jump", source: "chapter" },
    });
  }, [
    core.chapterEntries.length,
    core.currentChapterIndex,
    core.pagination.goToChapter,
  ]);

  const openInternalHref = useCallback(
    (href: string): boolean => {
      const resolvedTarget = resolveHref(href);
      if (!resolvedTarget) return false;

      if (resolvedTarget.targetId) {
        core.pagination.goToTarget(
          resolvedTarget.chapterIndex,
          resolvedTarget.targetId,
          { intent: { kind: "jump", source: "internal-link" } },
        );
        return true;
      }

      core.pagination.goToChapter(resolvedTarget.chapterIndex, {
        intent: { kind: "jump", source: "internal-link" },
      });
      return true;
    },
    [core.pagination.goToChapter, core.pagination.goToTarget, resolveHref],
  );

  const createHighlight = useCallback(
    (highlight: Highlight) => {
      addHighlightMutation.mutate(highlight);
    },
    [addHighlightMutation],
  );

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
      deferredImageCache: core.deferredImageCacheRef.current,
    }),
    [chapterAccess, core.deferredImageCacheRef],
  );

  const actions = useMemo<ReaderSessionActions>(
    () => ({
      updateSettings: core.onUpdateSettings,
      nextSpread,
      prevSpread,
      previewPage,
      commitPage,
      goToChapter,
      goToPreviousChapter,
      goToNextChapter,
      openInternalHref,
      createHighlight,
    }),
    [
      commitPage,
      core.onUpdateSettings,
      createHighlight,
      goToChapter,
      goToNextChapter,
      goToPreviousChapter,
      nextSpread,
      openInternalHref,
      previewPage,
      prevSpread,
    ],
  );

  return {
    state,
    resources,
    actions,
  };
}
