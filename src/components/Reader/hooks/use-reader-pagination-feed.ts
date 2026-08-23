import { usePagination } from "@/lib/pagination-v2";
import { useEffect, useLayoutEffect, useRef } from "react";
import type {
  ParsedChapterBlocks,
  ReaderInitialLocation,
} from "../data/chapter-content-pipeline";
import type { ReaderChapterArtifactSubscriber } from "../data/reader-cache/hooks";
import type { ChapterEntry } from "../types";

interface UseReaderPaginationFeedOptions {
  pagination: Pick<
    ReturnType<typeof usePagination>,
    "init" | "addChapter" | "updateChapter" | "status"
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
  const { addChapter, init, updateChapter } = pagination;
  const initializedBookIdRef = useRef<string | null>(null);

  useEffect(() => {
    initializedBookIdRef.current = null;
  }, [bookId]);

  useLayoutEffect(() => {
    if (
      !enabled ||
      !bookId ||
      !initialLocation ||
      chapterEntries.length === 0
    ) {
      return;
    }

    let initialized = false;

    const initializeIfReady = () => {
      if (initialized) return true;

      const firstChapterBlocks = getChapterBlocks(initialLocation.chapterIndex);
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
      initializedBookIdRef.current = bookId;
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
    subscribe,
    updateChapter,
  ]);
}
