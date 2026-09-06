import { usePagination } from "@/lib/pagination-v2";
import { useLayoutEffect, useRef } from "react";
import type {
  ParsedChapterBlocks,
  ReaderInitialLocation,
} from "../data/chapter-content-pipeline";
import type { ReaderChapterArtifactSubscriber } from "../data/reader-cache/hooks";
import type { ChapterEntry } from "../types";

interface UseReaderPaginationFeedOptions {
  pagination: Pick<
    ReturnType<typeof usePagination>,
    "init" | "addChapter" | "updateChapter" | "sessionGeneration"
  >;
  bookId?: string;
  chapterEntries: ChapterEntry[];
  getChapterBlocks: (chapterIndex: number) => ParsedChapterBlocks | null;
  subscribe: (listener: ReaderChapterArtifactSubscriber) => () => void;
  initialLocation: ReaderInitialLocation | null;
  enabled?: boolean;
}

/**
 * Bridges the reader-side content pipeline into pagination commands.
 *
 * The content hook owns loading and decoration. This hook owns the imperative
 * "feed the worker" contract: initialize with the first available chapter,
 * stream remaining chapters as they arrive, and send targeted updates when
 * loaded blocks change. The reader UI resumes background artifact work after
 * the first visible content is ready.
 */
export function useReaderPaginationFeed({
  pagination,
  bookId,
  chapterEntries,
  getChapterBlocks,
  subscribe,
  initialLocation,
  enabled = true,
}: UseReaderPaginationFeedOptions): void {
  const { addChapter, init, updateChapter, sessionGeneration } = pagination;
  const initializedSessionRef = useRef<{
    bookId: string;
    sessionGeneration: number;
    totalChapters: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (
      !enabled ||
      !bookId ||
      sessionGeneration === null ||
      !initialLocation ||
      chapterEntries.length === 0
    ) {
      return;
    }

    const initializeIfReady = () => {
      // A breakpoint change temporarily disables the feed while the stage is
      // measured again. Reconnect its subscription without replaying startup
      // restoration. A new book or worker session still needs its own init.
      const initialized = initializedSessionRef.current;
      if (
        initialized?.bookId === bookId &&
        initialized.sessionGeneration === sessionGeneration &&
        initialized.totalChapters === chapterEntries.length
      ) {
        return true;
      }

      const firstChapterBlocks = getChapterBlocks(initialLocation.chapterIndex);
      if (!firstChapterBlocks) return false;

      init({
        totalChapters: chapterEntries.length,
        initialChapterIndex: initialLocation.chapterIndex,
        initialChapterProgress: initialLocation.chapterProgress,
        initialHighlightId: initialLocation.highlightId,
        intent: initialLocation.highlightId
          ? { kind: "jump", source: "highlight" }
          : initialLocation.isRestore
            ? { kind: "restore" }
            : { kind: "replace" },
        firstChapterBlocks,
      });

      initializedSessionRef.current = {
        bookId,
        sessionGeneration,
        totalChapters: chapterEntries.length,
      };
      return true;
    };

    initializeIfReady();

    return subscribe((event) => {
      if (!initializeIfReady()) return;

      if (event.kind === "updated") {
        updateChapter(event.chapterIndex, event.artifact.blocks);
        return;
      }

      if (event.chapterIndex !== initialLocation.chapterIndex) {
        addChapter(event.chapterIndex, event.artifact.blocks);
      }
    });
  }, [
    addChapter,
    bookId,
    chapterEntries.length,
    enabled,
    getChapterBlocks,
    initialLocation,
    init,
    sessionGeneration,
    subscribe,
    updateChapter,
  ]);
}
