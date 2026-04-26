import type { Book } from "@/lib/db";
import type { ChapterCanonicalText } from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildChapterEntries,
  resolveInitialReaderLocation,
  type ParsedChapterBlocks,
  type ReaderDecoratedChapterArtifact,
  type ReaderInitialLocation,
} from "../data/chapter-content-pipeline";
import {
  useReaderBodyCacheQuery,
  useReaderChapterArtifactsQuery,
  useReaderCheckpointQuery,
} from "../data/reader-cache/hooks";
import type { ChapterEntry } from "../types";

interface UseReaderChapterContentOptions {
  bookId?: string;
  book: Book | null;
}

interface UseReaderChapterContentResult {
  chapterEntries: ChapterEntry[];
  bookHighlights: Highlight[];
  artifactsByChapter: (ReaderDecoratedChapterArtifact | null)[];
  initialLocation: ReaderInitialLocation | null;
  loadVersion: number;
  sourceLoadWallClockMs: number | null;
  getChapterBlocks: (chapterIndex: number) => ParsedChapterBlocks | null;
  getChapterCanonicalText: (
    chapterIndex: number,
  ) => ChapterCanonicalText | null;
}

/**
 * Composes the reader startup cache queries and exposes the artifacts needed by
 * pagination, annotations, and highlight interactions.
 */
export function useReaderChapterContent({
  bookId,
  book,
}: UseReaderChapterContentOptions): UseReaderChapterContentResult {
  const [loadVersion, setLoadVersion] = useState(0);
  const chapterEntries = useMemo(() => buildChapterEntries(book), [book]);
  const fileHash = book?.fileHash;

  const checkpointQuery = useReaderCheckpointQuery(bookId);
  const initialLocation = useMemo(() => {
    if (!checkpointQuery.isSuccess || chapterEntries.length === 0) return null;

    return resolveInitialReaderLocation(
      checkpointQuery.data.checkpoint,
      chapterEntries.length,
    );
  }, [chapterEntries.length, checkpointQuery.data, checkpointQuery.isSuccess]);

  const bodyCacheQuery = useReaderBodyCacheQuery({
    bookId,
    fileHash,
    chapterEntries,
  });

  const artifactsQuery = useReaderChapterArtifactsQuery({
    bookId,
    fileHash,
    chapterEntries,
    bodyCacheData: bodyCacheQuery.data,
    initialLocation,
  });

  useEffect(() => {
    setLoadVersion((version) => version + 1);
  }, [bookId, chapterEntries, fileHash]);

  const artifactsByChapter = useMemo(
    () => artifactsQuery.data?.artifactsByChapter ?? [],
    [artifactsQuery.data?.artifactsByChapter],
  );

  const getChapterBlocks = useCallback(
    (chapterIndex: number): ParsedChapterBlocks | null =>
      artifactsByChapter[chapterIndex]?.blocks ?? null,
    [artifactsByChapter],
  );

  const getChapterCanonicalText = useCallback(
    (chapterIndex: number): ChapterCanonicalText | null =>
      artifactsQuery.data?.baseContentByChapter.get(chapterIndex)
        ?.canonicalText ?? null,
    [artifactsQuery.data],
  );

  return {
    chapterEntries,
    bookHighlights: artifactsQuery.bookHighlights,
    artifactsByChapter,
    initialLocation,
    loadVersion,
    sourceLoadWallClockMs: bodyCacheQuery.data?.loadWallClockMs ?? null,
    getChapterBlocks,
    getChapterCanonicalText,
  };
}
