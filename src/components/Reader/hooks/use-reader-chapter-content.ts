import { useBookHighlightsQuery } from "@/hooks/use-highlights-query";
import {
  getBookFilesByPaths,
  getBookImageDimensionsMap,
  getCurrentDeviceReadingCheckpoint,
  type Book,
} from "@/lib/db";
import type { ChapterCanonicalText } from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildChapterEntries,
  decorateChapterContent,
  didDecoratedChapterBlocksChange,
  loadBaseChapterContent,
  resolveInitialReaderLocation,
  type ParsedChapterBlocks,
  type ReaderBaseChapterContent,
  type ReaderDecoratedChapterArtifact,
  type ReaderInitialLocation,
} from "../data/chapter-content-pipeline";
import { buildHighlightsBySpineItemId } from "../highlight-virtualization";
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

function createEmptyArtifactList(
  chapterCount: number,
): (ReaderDecoratedChapterArtifact | null)[] {
  return Array.from<ReaderDecoratedChapterArtifact | null>({
    length: chapterCount,
  }).fill(null);
}

function pruneRemovedChapters(
  chapterEntries: ChapterEntry[],
  ...maps: Map<number, unknown>[]
): void {
  const validChapterIndices = new Set(
    chapterEntries.map((chapter) => chapter.index),
  );

  for (const map of maps) {
    for (const chapterIndex of map.keys()) {
      if (validChapterIndices.has(chapterIndex)) continue;
      map.delete(chapterIndex);
    }
  }
}

/**
 * Owns the reader-side chapter content pipeline:
 * - load base chapter HTML and canonical text from IndexedDB-backed EPUB files
 * - redecorate chapters when highlight data changes
 * - expose stable chapter accessors for pagination and annotations
 */
export function useReaderChapterContent({
  bookId,
  book,
}: UseReaderChapterContentOptions): UseReaderChapterContentResult {
  const [sourceLoadWallClockMs, setSourceLoadWallClockMs] = useState<
    number | null
  >(null);
  const [initialLocation, setInitialLocation] =
    useState<ReaderInitialLocation | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [artifactsByChapter, setArtifactsByChapter] = useState<
    (ReaderDecoratedChapterArtifact | null)[]
  >([]);

  const chapterEntries = useMemo(() => buildChapterEntries(book), [book]);
  const { data: bookHighlights = [] } = useBookHighlightsQuery(bookId);

  const highlightsBySpineItemId = useMemo(
    () => buildHighlightsBySpineItemId(bookHighlights),
    [bookHighlights],
  );

  const highlightsBySpineItemIdRef = useRef<Map<string, Highlight[]>>(
    new Map(),
  );
  highlightsBySpineItemIdRef.current = highlightsBySpineItemId;

  const baseContentByChapterRef = useRef<Map<number, ReaderBaseChapterContent>>(
    new Map(),
  );
  const decoratedArtifactByChapterRef = useRef<
    Map<number, ReaderDecoratedChapterArtifact>
  >(new Map());

  const writeArtifact = useCallback(
    (artifact: ReaderDecoratedChapterArtifact) => {
      decoratedArtifactByChapterRef.current.set(
        artifact.chapterIndex,
        artifact,
      );
      setArtifactsByChapter((previousArtifacts) => {
        const nextArtifacts =
          previousArtifacts.length === chapterEntries.length
            ? [...previousArtifacts]
            : createEmptyArtifactList(chapterEntries.length);
        nextArtifacts[artifact.chapterIndex] = artifact;
        return nextArtifacts;
      });
    },
    [chapterEntries.length],
  );

  useEffect(() => {
    if (!bookId || chapterEntries.length === 0) {
      baseContentByChapterRef.current.clear();
      decoratedArtifactByChapterRef.current.clear();
      setSourceLoadWallClockMs(null);
      setInitialLocation(null);
      setArtifactsByChapter([]);
      return;
    }

    let cancelled = false;
    setLoadVersion((version) => version + 1);
    setSourceLoadWallClockMs(null);
    setInitialLocation(null);
    setArtifactsByChapter(createEmptyArtifactList(chapterEntries.length));
    baseContentByChapterRef.current.clear();
    decoratedArtifactByChapterRef.current.clear();

    const loadAllChapterContent = async () => {
      const startedAt = performance.now();

      try {
        // Stage 1: load base content, then publish the decorated artifact for
        // each chapter as soon as it is available so pagination can start early.
        const [imageDimensionsByPath, checkpoint] = await Promise.all([
          getBookImageDimensionsMap(bookId),
          getCurrentDeviceReadingCheckpoint(bookId),
        ]);
        if (cancelled) return;

        const nextInitialLocation = resolveInitialReaderLocation(
          checkpoint,
          chapterEntries.length,
        );
        setInitialLocation(nextInitialLocation);

        const allChapterFiles = await getBookFilesByPaths(
          bookId,
          chapterEntries.map((chapter) => chapter.href),
        );
        if (cancelled) return;

        const requireChapterFile = (chapter: ChapterEntry) => {
          const chapterFile = allChapterFiles.get(chapter.href);
          if (chapterFile) return chapterFile;

          throw new Error(
            `Missing chapter file for href "${chapter.href}" (chapter ${chapter.index})`,
          );
        };

        const initialChapter =
          chapterEntries[nextInitialLocation.chapterIndex]!;

        const loadAndPublishBaseContent = async (
          chapterIndex: number,
          chapter: ChapterEntry,
        ) => {
          const baseContent = await loadBaseChapterContent({
            chapterIndex,
            chapterFile: requireChapterFile(chapter),
            chapter,
            imageDimensionsByPath,
          });
          if (cancelled) return;

          baseContentByChapterRef.current.set(
            baseContent.chapterIndex,
            baseContent,
          );
          writeArtifact(
            decorateChapterContent({
              baseContent,
              highlightsBySpineItemId: highlightsBySpineItemIdRef.current,
            }),
          );
        };

        await loadAndPublishBaseContent(
          nextInitialLocation.chapterIndex,
          initialChapter,
        );
        if (cancelled) return;

        for (
          let chapterIndex = 0;
          chapterIndex < chapterEntries.length;
          chapterIndex++
        ) {
          if (chapterIndex === nextInitialLocation.chapterIndex) continue;

          const chapter = chapterEntries[chapterIndex]!;
          await loadAndPublishBaseContent(chapterIndex, chapter);
          if (cancelled) return;
        }

        if (!cancelled) {
          setSourceLoadWallClockMs(performance.now() - startedAt);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[Reader] Failed to load chapter content", error);
        }
      }
    };

    void loadAllChapterContent();

    return () => {
      cancelled = true;
    };
  }, [bookId, chapterEntries, writeArtifact]);

  useEffect(() => {
    if (!bookId || chapterEntries.length === 0) return;

    // Stage 2: highlights only invalidate the decoration step. We reuse the
    // loaded base HTML/canonical text and only republish chapters whose
    // highlighted HTML changed.
    pruneRemovedChapters(
      chapterEntries,
      baseContentByChapterRef.current,
      decoratedArtifactByChapterRef.current,
    );

    const changedArtifacts: ReaderDecoratedChapterArtifact[] = [];

    for (const [chapterIndex] of chapterEntries.entries()) {
      const baseContent = baseContentByChapterRef.current.get(chapterIndex);
      if (!baseContent) continue;

      const nextArtifact = decorateChapterContent({
        baseContent,
        highlightsBySpineItemId,
      });
      const previousArtifact =
        decoratedArtifactByChapterRef.current.get(chapterIndex);
      if (
        previousArtifact &&
        previousArtifact.highlightSignature === nextArtifact.highlightSignature
      ) {
        continue;
      }

      decoratedArtifactByChapterRef.current.set(chapterIndex, nextArtifact);
      if (
        !previousArtifact ||
        didDecoratedChapterBlocksChange(previousArtifact, nextArtifact)
      ) {
        changedArtifacts.push(nextArtifact);
      }
    }

    if (changedArtifacts.length === 0) return;

    setArtifactsByChapter((previousArtifacts) => {
      const nextArtifacts =
        previousArtifacts.length === chapterEntries.length
          ? [...previousArtifacts]
          : createEmptyArtifactList(chapterEntries.length);

      for (const artifact of changedArtifacts) {
        nextArtifacts[artifact.chapterIndex] = artifact;
      }

      return nextArtifacts;
    });
  }, [bookId, chapterEntries, highlightsBySpineItemId]);

  const getChapterBlocks = useCallback(
    (chapterIndex: number): ParsedChapterBlocks | null =>
      decoratedArtifactByChapterRef.current.get(chapterIndex)?.blocks ?? null,
    [],
  );

  const getChapterCanonicalText = useCallback(
    (chapterIndex: number): ChapterCanonicalText | null =>
      baseContentByChapterRef.current.get(chapterIndex)?.canonicalText ?? null,
    [],
  );

  return {
    chapterEntries,
    bookHighlights,
    artifactsByChapter,
    initialLocation,
    loadVersion,
    sourceLoadWallClockMs,
    getChapterBlocks,
    getChapterCanonicalText,
  };
}
