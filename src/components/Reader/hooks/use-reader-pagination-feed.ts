import { usePagination } from "@/lib/pagination-v2";
import { useEffect } from "react";
import type {
  ParsedChapterBlocks,
  ReaderInitialLocation,
} from "../data/chapter-content-pipeline";
import type { ReaderChapterArtifactSubscriber } from "../data/reader-cache/hooks";
import type { ChapterEntry } from "../types";

interface UseReaderPaginationFeedOptions {
  pagination: Pick<
    ReturnType<typeof usePagination>,
    "init" | "addChapter" | "updateChapter"
  >;
  bookId?: string;
  chapterEntries: ChapterEntry[];
  getChapterBlocks: (chapterIndex: number) => ParsedChapterBlocks | null;
  subscribe: (listener: ReaderChapterArtifactSubscriber) => () => void;
  initialLocation: ReaderInitialLocation | null;
}

/**
 * Bridges the reader-side content pipeline into pagination commands.
 *
 * The content hook owns loading and decoration. This hook owns the imperative
 * "feed the worker" contract: initialize with the first available chapter,
 * stream remaining chapters as they arrive, and send targeted updates when a
 * loaded chapter's decorated blocks change.
 */
export function useReaderPaginationFeed({
  pagination,
  bookId,
  chapterEntries,
  getChapterBlocks,
  subscribe,
  initialLocation,
}: UseReaderPaginationFeedOptions): void {
  const { addChapter, init, updateChapter } = pagination;

  useEffect(() => {
    if (!bookId || !initialLocation || chapterEntries.length === 0) return;

    let initialized = false;

    const initializeIfReady = () => {
      if (initialized) return true;

      const firstChapterBlocks = getChapterBlocks(
        initialLocation.chapterIndex,
      );
      if (!firstChapterBlocks) return false;

      init({
        totalChapters: chapterEntries.length,
        initialChapterIndex: initialLocation.chapterIndex,
        initialChapterProgress: initialLocation.chapterProgress,
        intent: initialLocation.isRestore
          ? { kind: "restore" }
          : { kind: "replace" },
        firstChapterBlocks,
      });

      initialized = true;
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
    getChapterBlocks,
    initialLocation,
    init,
    subscribe,
    updateChapter,
  ]);
}
