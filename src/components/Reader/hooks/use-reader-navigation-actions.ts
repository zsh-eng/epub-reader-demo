import { splitHrefFragment } from "@/lib/epub-resource-utils";
import type { SpreadIntent } from "@/lib/pagination-v2/types";
import { useCallback, useMemo } from "react";
import { resolvePaginatedLinkTarget } from "../link-navigation";
import type { ChapterEntry } from "../types";

interface ReaderPaginationNavigation {
  nextSpread: () => void;
  prevSpread: () => void;
  goToPage: (page: number, options: { intent: SpreadIntent }) => void;
  goToChapter: (
    chapterIndex: number,
    options: { intent: SpreadIntent },
  ) => void;
  goToTarget: (
    chapterIndex: number,
    targetId: string,
    options: { intent: SpreadIntent },
  ) => void;
}

interface UseReaderNavigationActionsOptions {
  pagination: ReaderPaginationNavigation;
  currentChapterIndex: number;
  chapterEntries: ChapterEntry[];
}

export interface ReaderNavigationActions {
  nextSpread: () => void;
  prevSpread: () => void;
  previewPage: (page: number) => void;
  commitPage: (page: number) => void;
  goToChapter: (chapterIndex: number) => void;
  goToPreviousChapter: () => void;
  goToNextChapter: () => void;
  openInternalHref: (href: string) => boolean;
}

/**
 * Bundles the reader's high-level navigation intents so screen components and
 * facades can consume one stable action surface instead of rebuilding the same
 * `useCallback` wrappers around pagination commands.
 */
export function useReaderNavigationActions({
  pagination,
  currentChapterIndex,
  chapterEntries,
}: UseReaderNavigationActionsOptions): ReaderNavigationActions {
  const chapterIndexByHrefPath = useMemo(() => {
    const hrefMap = new Map<string, number>();
    for (const chapter of chapterEntries) {
      hrefMap.set(splitHrefFragment(chapter.href).path, chapter.index);
    }
    return hrefMap;
  }, [chapterEntries]);

  const resolveHrefTarget = useCallback(
    (href: string) => resolvePaginatedLinkTarget(href, chapterIndexByHrefPath),
    [chapterIndexByHrefPath],
  );

  const nextSpread = useCallback(() => {
    pagination.nextSpread();
  }, [pagination]);

  const prevSpread = useCallback(() => {
    pagination.prevSpread();
  }, [pagination]);

  const previewPage = useCallback(
    (page: number) => {
      pagination.goToPage(page, {
        intent: { kind: "preview", source: "scrubber" },
      });
    },
    [pagination],
  );

  const commitPage = useCallback(
    (page: number) => {
      pagination.goToPage(page, {
        intent: { kind: "jump", source: "scrubber" },
      });
    },
    [pagination],
  );

  const goToChapter = useCallback(
    (chapterIndex: number) => {
      pagination.goToChapter(chapterIndex, {
        intent: { kind: "jump", source: "chapter" },
      });
    },
    [pagination],
  );

  const goToPreviousChapter = useCallback(() => {
    if (currentChapterIndex <= 0) return;
    pagination.goToChapter(currentChapterIndex - 1, {
      intent: { kind: "jump", source: "chapter" },
    });
  }, [currentChapterIndex, pagination]);

  const goToNextChapter = useCallback(() => {
    if (currentChapterIndex >= chapterEntries.length - 1) return;
    pagination.goToChapter(currentChapterIndex + 1, {
      intent: { kind: "jump", source: "chapter" },
    });
  }, [chapterEntries.length, currentChapterIndex, pagination]);

  const openInternalHref = useCallback(
    (href: string): boolean => {
      const resolvedTarget = resolveHrefTarget(href);
      if (!resolvedTarget) return false;

      if (resolvedTarget.targetId) {
        pagination.goToTarget(
          resolvedTarget.chapterIndex,
          resolvedTarget.targetId,
          {
            intent: { kind: "jump", source: "internal-link" },
          },
        );
        return true;
      }

      pagination.goToChapter(resolvedTarget.chapterIndex, {
        intent: { kind: "jump", source: "internal-link" },
      });
      return true;
    },
    [pagination, resolveHrefTarget],
  );

  return useMemo(
    () => ({
      nextSpread,
      prevSpread,
      previewPage,
      commitPage,
      goToChapter,
      goToPreviousChapter,
      goToNextChapter,
      openInternalHref,
    }),
    [
      commitPage,
      goToChapter,
      goToNextChapter,
      goToPreviousChapter,
      nextSpread,
      openInternalHref,
      previewPage,
      prevSpread,
    ],
  );
}
