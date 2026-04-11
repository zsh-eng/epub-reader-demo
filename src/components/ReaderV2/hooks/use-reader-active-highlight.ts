import type { ResolvedSpread } from "@/lib/pagination-v2/types";
import {
  EPUB_HIGHLIGHT_ACTIVE_CLASS,
  EPUB_HIGHLIGHT_CLASS,
  EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
  EPUB_HIGHLIGHT_GROUP_HOVER_CLASS,
} from "@/types/reader.types";
import type { Highlight } from "@/types/highlight";
import {
  createHighlightInteractionManager,
  type HighlightInteractionManager,
} from "@zsh-eng/text-highlighter";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ChapterEntry } from "../types";

export interface ActiveHighlightState {
  id: string;
  position: { x: number; y: number };
}

interface UseReaderActiveHighlightOptions {
  spread: ResolvedSpread | null;
  stageContentRef: RefObject<HTMLDivElement | null>;
  chapterEntries: ChapterEntry[];
  bookHighlights: Highlight[];
}

function getVisibleSpineItemIds(
  spread: ResolvedSpread | null,
  chapterEntries: ChapterEntry[],
): Set<string> {
  if (!spread) return new Set<string>();

  const start = spread.chapterIndexStart;
  const end = spread.chapterIndexEnd;
  if (start === null || end === null) {
    return new Set<string>();
  }

  const visibleIds = new Set<string>();
  for (let chapterIndex = start; chapterIndex <= end; chapterIndex++) {
    const chapter = chapterEntries[chapterIndex];
    if (!chapter) continue;
    visibleIds.add(chapter.spineItemId);
  }

  return visibleIds;
}

export function useReaderActiveHighlight({
  spread,
  stageContentRef,
  chapterEntries,
  bookHighlights,
}: UseReaderActiveHighlightOptions) {
  const [activeHighlight, setActiveHighlight] =
    useState<ActiveHighlightState | null>(null);
  const highlightManagerRef = useRef<HighlightInteractionManager | null>(null);

  const visibleSpineItemIds = useMemo(
    () => getVisibleSpineItemIds(spread, chapterEntries),
    [chapterEntries, spread],
  );

  const visibleHighlights = useMemo(
    () =>
      bookHighlights.filter((highlight) =>
        visibleSpineItemIds.has(highlight.spineItemId),
      ),
    [bookHighlights, visibleSpineItemIds],
  );

  const activeHighlightData = useMemo(() => {
    if (!activeHighlight) return null;

    return (
      bookHighlights.find((highlight) => highlight.id === activeHighlight.id) ??
      null
    );
  }, [activeHighlight, bookHighlights]);

  useEffect(() => {
    const container = stageContentRef.current;
    if (!container) return;

    const manager = createHighlightInteractionManager(container, {
      highlightClass: EPUB_HIGHLIGHT_CLASS,
      idAttribute: EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
      hoverClass: EPUB_HIGHLIGHT_GROUP_HOVER_CLASS,
      activeClass: EPUB_HIGHLIGHT_ACTIVE_CLASS,
      onHighlightClick: (id, position) => {
        setActiveHighlight((previousHighlight) => {
          if (previousHighlight?.id === id) {
            return null;
          }

          return { id, position };
        });
      },
    });

    highlightManagerRef.current = manager;
    return () => {
      manager.destroy();
      if (highlightManagerRef.current === manager) {
        highlightManagerRef.current = null;
      }
    };
  }, [spread, stageContentRef]);

  useEffect(() => {
    highlightManagerRef.current?.setActiveHighlight(activeHighlight?.id ?? null);
  }, [activeHighlight, spread]);

  useEffect(() => {
    if (!activeHighlight) return;

    const isHighlightStillVisible = visibleHighlights.some(
      (highlight) => highlight.id === activeHighlight.id,
    );
    if (!isHighlightStillVisible) {
      setActiveHighlight(null);
    }
  }, [activeHighlight, visibleHighlights]);

  const clearActiveHighlight = useCallback(() => {
    setActiveHighlight(null);
  }, []);

  return {
    activeHighlight,
    activeHighlightData,
    clearActiveHighlight,
  };
}
