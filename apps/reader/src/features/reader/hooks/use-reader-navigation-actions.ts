import type { Highlight } from "@/types/highlight";
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
    options: { intent: SpreadIntent; targetKind?: "element" | "highlight" },
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
  jumpToHandoffPage: (page: number) => void;
  goToChapter: (chapterIndex: number) => void;
  goToPreviousChapter: () => void;
  goToNextChapter: () => void;
  openInternalHref: (href: string) => boolean;
  openTocHref: (href: string) => boolean;
  goToNotePage: (page: number) => void;
  goToHighlight: (highlight: Highlight) => void;
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

  const jumpToHandoffPage = useCallback(
    (page: number) => {
      pagination.goToPage(page, {
        intent: { kind: "jump", source: "handoff" },
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

  const openHref = useCallback(
    (href: string, source: "internal-link" | "toc"): boolean => {
      const resolvedTarget = resolveHrefTarget(href);
      if (!resolvedTarget) return false;

      if (resolvedTarget.targetId) {
        pagination.goToTarget(
          resolvedTarget.chapterIndex,
          resolvedTarget.targetId,
          {
            intent: { kind: "jump", source },
          },
        );
        return true;
      }

      pagination.goToChapter(resolvedTarget.chapterIndex, {
        intent: { kind: "jump", source },
      });
      return true;
    },
    [pagination, resolveHrefTarget],
  );

  const openInternalHref = useCallback(
    (href: string) => openHref(href, "internal-link"),
    [openHref],
  );
  const openTocHref = useCallback(
    (href: string) => openHref(href, "toc"),
    [openHref],
  );
  const goToNotePage = useCallback(
    (page: number) => {
      pagination.goToPage(page, { intent: { kind: "jump", source: "note" } });
    },
    [pagination],
  );

  const goToHighlight = useCallback(
    (highlight: Highlight) => {
      const chapter = chapterEntries.find(
        (entry) => entry.spineItemId === highlight.spineItemId,
      );
      if (!chapter) return;
      pagination.goToTarget(chapter.index, highlight.id, {
        intent: { kind: "jump", source: "highlight" },
        targetKind: "highlight",
      });
    },
    [chapterEntries, pagination],
  );

  return useMemo(
    () => ({
      nextSpread,
      prevSpread,
      previewPage,
      commitPage,
      jumpToHandoffPage,
      goToChapter,
      goToPreviousChapter,
      goToNextChapter,
      openInternalHref,
      openTocHref,
      goToNotePage,
      goToHighlight,
    }),
    [
      commitPage,
      goToChapter,
      goToNextChapter,
      goToPreviousChapter,
      jumpToHandoffPage,
      nextSpread,
      openInternalHref,
      openTocHref,
      goToNotePage,
      goToHighlight,
      previewPage,
      prevSpread,
    ],
  );
}
