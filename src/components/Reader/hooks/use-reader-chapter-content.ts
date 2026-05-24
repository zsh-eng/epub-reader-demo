import { useBookHighlightsQuery } from "@/hooks/use-highlights-query";
import type { Book } from "@/lib/db";
import type { ChapterCanonicalText } from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import { useCallback, useMemo } from "react";
import {
  buildChapterEntries,
  type ParsedChapterBlocks,
  type ReaderInitialLocation,
} from "../data/chapter-content-pipeline";
import {
  useReaderBodyCacheQuery,
  useReaderChapterArtifactsLoader,
  useReaderCheckpointQuery,
  type ReaderChapterArtifactSubscriber,
  type ReaderBodyCacheLoadKind,
} from "../data/reader-cache/hooks";
import type { ChapterEntry } from "../types";
import { useSessionInitialReaderLocation } from "./use-session-initial-reader-location";

interface UseReaderChapterContentOptions {
  bookId?: string;
  book: Book | null;
  publisherBookStylingEnabled: boolean;
}

interface UseReaderChapterContentResult {
  chapterEntries: ChapterEntry[];
  bookHighlights: Highlight[];
  initialLocation: ReaderInitialLocation | null;
  sourceLoadWallClockMs: number | null;
  sourceLoadKind: ReaderBodyCacheLoadKind | null;
  getChapterBlocks: (chapterIndex: number) => ParsedChapterBlocks | null;
  getChapterCanonicalText: (
    chapterIndex: number,
  ) => ChapterCanonicalText | null;
  subscribe: (listener: ReaderChapterArtifactSubscriber) => () => void;
}

/**
 * Composes the reader startup cache queries and exposes the artifacts needed by
 * pagination, annotations, and highlight interactions.
 */
export function useReaderChapterContent({
  bookId,
  book,
  publisherBookStylingEnabled,
}: UseReaderChapterContentOptions): UseReaderChapterContentResult {
  const chapterEntries = useMemo(() => buildChapterEntries(book), [book]);
  const fileHash = book?.fileHash;

  const checkpointQuery = useReaderCheckpointQuery(bookId);
  const initialLocation = useSessionInitialReaderLocation({
    bookId,
    totalChapters: chapterEntries.length,
    checkpoint: checkpointQuery.data?.checkpoint,
    checkpointReady: checkpointQuery.isSuccess,
  });

  const bodyCacheQuery = useReaderBodyCacheQuery({
    bookId,
    fileHash,
    chapterEntries,
    publisherBookStylingEnabled,
  });
  const highlightsQuery = useBookHighlightsQuery(bookId);
  const bookHighlights = highlightsQuery.data ?? [];

  const artifactsLoader = useReaderChapterArtifactsLoader({
    bookId,
    fileHash,
    chapterEntries,
    baseContentByChapter: bodyCacheQuery.data?.baseContentByChapter,
    initialLocation,
    highlights: bookHighlights,
    enabled: highlightsQuery.isSuccess,
    publisherBookStylingEnabled,
  });

  const getChapterCanonicalText = useCallback(
    (chapterIndex: number): ChapterCanonicalText | null =>
      bodyCacheQuery.data?.baseContentByChapter.get(chapterIndex)
        ?.canonicalText ?? null,
    [bodyCacheQuery.data],
  );

  return {
    chapterEntries,
    bookHighlights,
    initialLocation,
    sourceLoadWallClockMs: bodyCacheQuery.data?.loadWallClockMs ?? null,
    sourceLoadKind: bodyCacheQuery.data?.loadKind ?? null,
    getChapterBlocks: artifactsLoader.getChapterBlocks,
    getChapterCanonicalText,
    subscribe: artifactsLoader.subscribe,
  };
}
