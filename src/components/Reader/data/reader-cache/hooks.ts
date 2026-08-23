import {
  getCurrentDeviceReadingCheckpoint,
  getReadingCheckpointsForBook,
  type SyncedReadingCheckpoint,
} from "@/lib/db";
import {
  endReaderTraceSpan,
  startReaderTraceSpan,
  withReaderTraceSpan,
} from "@/lib/reader-performance-trace";
import { ensurePublisherFontsReadyFromBlocks } from "@/lib/pagination-v2/shared/publisher-fonts";
import type { Highlight } from "@/types/highlight";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  buildHighlightSignature,
  buildHighlightsBySpineItemId,
} from "../../highlight-virtualization";
import type { ChapterEntry } from "../../types";
import {
  buildReaderChapterLoadOrder,
  didDecoratedChapterBlocksChange,
  type ParsedChapterBlocks,
  type ReaderBaseChapterContent,
  type ReaderDecoratedChapterArtifact,
  type ReaderInitialLocation,
} from "../chapter-content-pipeline";
import {
  buildReaderChapterArtifact,
  loadReaderBodyCache,
  READER_BODY_CACHE_SCHEMA_VERSION,
  READER_CHAPTER_ARTIFACTS_GC_MS,
  READER_CHAPTER_ARTIFACTS_SCHEMA_VERSION,
  type ReaderBodyCacheLoadKind,
} from "./cache";

export type { ReaderBodyCacheLoadKind };

export const readerBodyCacheKeys = {
  book: (
    bookId: string,
    fileHash: string,
    publisherBookStylingEnabled: boolean,
    matchPublisherBodyTextSize: boolean,
  ) =>
    [
      "readerBodyCache",
      READER_BODY_CACHE_SCHEMA_VERSION,
      bookId,
      fileHash,
      getPublisherStylingCacheKey(publisherBookStylingEnabled),
      matchPublisherBodyTextSize ? "body-size-match-on" : "body-size-match-off",
    ] as const,
};

export const readerCheckpointKeys = {
  currentDevice: (bookId: string) =>
    ["readingCheckpoint", "currentDevice", bookId] as const,
  book: (bookId: string) => ["readingCheckpoints", "book", bookId] as const,
};

export const readerChapterArtifactKeys = {
  chapter: (
    bookId: string,
    fileHash: string,
    chapterIndex: number,
    spineItemId: string,
    highlightSignature: string,
    publisherBookStylingEnabled: boolean,
    matchPublisherBodyTextSize: boolean,
    publisherBodyFontScale: number | undefined,
  ) =>
    [
      "readerChapterArtifact",
      READER_CHAPTER_ARTIFACTS_SCHEMA_VERSION,
      READER_BODY_CACHE_SCHEMA_VERSION,
      bookId,
      fileHash,
      chapterIndex,
      spineItemId,
      highlightSignature,
      getPublisherStylingCacheKey(publisherBookStylingEnabled),
      getPublisherBodySizeCacheKey(
        publisherBookStylingEnabled,
        matchPublisherBodyTextSize,
        publisherBodyFontScale,
      ),
    ] as const,
};

function getPublisherStylingCacheKey(enabled: boolean): string {
  return enabled ? "publisher-styling-on" : "publisher-styling-off";
}

function getPublisherBodySizeCacheKey(
  publisherBookStylingEnabled: boolean,
  matchPublisherBodyTextSize: boolean,
  publisherBodyFontScale: number | undefined,
): string {
  if (!publisherBookStylingEnabled || !matchPublisherBodyTextSize) {
    return "body-size-literal";
  }

  return publisherBodyFontScale
    ? `body-size-matched:${publisherBodyFontScale}`
    : "body-size-matched:none";
}

export interface ReaderCheckpointData {
  checkpoint: SyncedReadingCheckpoint | undefined;
}

export interface ReaderCheckpointsData {
  checkpoints: SyncedReadingCheckpoint[];
}

export function useReaderBodyCacheQuery(options: {
  bookId?: string;
  fileHash?: string;
  chapterEntries: ChapterEntry[];
  publisherBookStylingEnabled: boolean;
  matchPublisherBodyTextSize: boolean;
}) {
  const {
    bookId,
    fileHash,
    chapterEntries,
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
  } = options;

  return useQuery({
    queryKey: readerBodyCacheKeys.book(
      bookId ?? "",
      fileHash ?? "",
      publisherBookStylingEnabled,
      matchPublisherBodyTextSize,
    ),
    queryFn: () =>
      loadReaderBodyCache({
        bookId: bookId!,
        fileHash: fileHash!,
        chapterEntries,
        publisherBookStylingEnabled,
        matchPublisherBodyTextSize,
      }),
    enabled: !!bookId && !!fileHash && chapterEntries.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useReaderCheckpointQuery(bookId: string | undefined) {
  return useQuery({
    queryKey: readerCheckpointKeys.currentDevice(bookId ?? ""),
    queryFn: async (): Promise<ReaderCheckpointData> => ({
      checkpoint: await withReaderTraceSpan(
        "reading-checkpoint-read",
        "storage",
        () => getCurrentDeviceReadingCheckpoint(bookId!),
      ),
    }),
    enabled: !!bookId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useReaderCheckpointsQuery(bookId: string | undefined) {
  return useQuery({
    queryKey: readerCheckpointKeys.book(bookId ?? ""),
    queryFn: async (): Promise<ReaderCheckpointsData> => ({
      checkpoints: await withReaderTraceSpan(
        "reading-checkpoints-read",
        "storage",
        () => getReadingCheckpointsForBook(bookId!),
      ),
    }),
    enabled: !!bookId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export type ReaderChapterArtifactEvent =
  | {
      kind: "loaded";
      chapterIndex: number;
      artifact: ReaderDecoratedChapterArtifact;
    }
  | {
      kind: "updated";
      chapterIndex: number;
      artifact: ReaderDecoratedChapterArtifact;
    };

export type ReaderChapterArtifactSubscriber = (
  event: ReaderChapterArtifactEvent,
) => void;

export interface ReaderChapterArtifactsLoader {
  getChapterBlocks: (chapterIndex: number) => ParsedChapterBlocks | null;
  subscribe: (listener: ReaderChapterArtifactSubscriber) => () => void;
}

/**
 * Keeps decorated reader artifacts out of React render data. Highlight changes
 * update the relevant chapter cache row and notify subscribers imperatively.
 */
export function useReaderChapterArtifactsLoader(options: {
  bookId?: string;
  fileHash?: string;
  chapterEntries: ChapterEntry[];
  baseContentByChapter: Map<number, ReaderBaseChapterContent> | undefined;
  initialLocation: ReaderInitialLocation | null;
  highlights: Highlight[];
  enabled: boolean;
  publisherBookStylingEnabled: boolean;
  matchPublisherBodyTextSize: boolean;
}): ReaderChapterArtifactsLoader {
  const {
    bookId,
    fileHash,
    chapterEntries,
    baseContentByChapter,
    initialLocation,
    highlights,
    enabled,
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
  } = options;
  const queryClient = useQueryClient();
  const artifactsByChapterRef = useRef<
    Map<number, ReaderDecoratedChapterArtifact>
  >(new Map());
  const signaturesByChapterRef = useRef<Map<number, string>>(new Map());
  const listenersRef = useRef<Set<ReaderChapterArtifactSubscriber>>(new Set());

  const highlightsBySpineItemId = useMemo(
    () => buildHighlightsBySpineItemId(highlights),
    [highlights],
  );

  const notify = useCallback((event: ReaderChapterArtifactEvent) => {
    for (const listener of listenersRef.current) listener(event);
  }, []);

  useEffect(() => {
    artifactsByChapterRef.current.clear();
    signaturesByChapterRef.current.clear();
    listenersRef.current.clear();
  }, [bookId]);

  useEffect(() => {
    if (
      !enabled ||
      !bookId ||
      !fileHash ||
      !baseContentByChapter ||
      !initialLocation
    ) {
      return;
    }

    const resolvedBookId = bookId;
    const resolvedFileHash = fileHash;
    const resolvedBaseContentByChapter = baseContentByChapter;
    const resolvedInitialLocation = initialLocation;

    async function loadArtifacts() {
      const chapterLoadOrder = buildReaderChapterLoadOrder(
        chapterEntries.length,
        resolvedInitialLocation.chapterIndex,
      );
      const firstChapterIndex = chapterLoadOrder[0];
      const allArtifactsSpan = startReaderTraceSpan(
        "chapter-artifacts-load",
        "processing",
        { chapterCount: chapterLoadOrder.length },
      );
      const firstArtifactSpan = startReaderTraceSpan(
        "initial-chapter-artifact",
        "processing",
        { chapterIndex: firstChapterIndex ?? 0 },
      );
      let firstArtifactEnded = false;
      let cachedArtifactCount = 0;
      let builtArtifactCount = 0;

      const endFirstArtifact = (
        details: Record<string, string | number | boolean>,
      ) => {
        if (firstArtifactEnded) return;
        firstArtifactEnded = true;
        endReaderTraceSpan(firstArtifactSpan, details);
      };

      try {
        for (const chapterIndex of chapterLoadOrder) {
          const chapter = chapterEntries[chapterIndex]!;
          const baseContent = resolvedBaseContentByChapter.get(chapterIndex)!;
          const chapterHighlights =
            highlightsBySpineItemId.get(chapter.spineItemId) ?? [];
          const highlightSignature = buildHighlightSignature(chapterHighlights);
          const artifactSignature = `${getPublisherStylingCacheKey(
            publisherBookStylingEnabled,
          )}:${getPublisherBodySizeCacheKey(
            publisherBookStylingEnabled,
            matchPublisherBodyTextSize,
            baseContent.publisherBodyFontScale,
          )}:${highlightSignature}`;
          const previousSignature =
            signaturesByChapterRef.current.get(chapterIndex);
          const previousArtifact =
            artifactsByChapterRef.current.get(chapterIndex);

          if (previousArtifact && previousSignature === artifactSignature) {
            if (chapterIndex === firstChapterIndex) {
              endFirstArtifact({ cache: "loader-memory" });
            }
            continue;
          }

          const queryKey = readerChapterArtifactKeys.chapter(
            resolvedBookId,
            resolvedFileHash,
            chapterIndex,
            chapter.spineItemId,
            highlightSignature,
            publisherBookStylingEnabled,
            matchPublisherBodyTextSize,
            baseContent.publisherBodyFontScale,
          );
          const cachedArtifact =
            queryClient.getQueryData<ReaderDecoratedChapterArtifact>(queryKey);
          const artifact =
            cachedArtifact ??
            (await queryClient.ensureQueryData({
              queryKey,
              queryFn: () =>
                buildReaderChapterArtifact({
                  baseContent,
                  highlights: chapterHighlights,
                  publisherBookStylingEnabled,
                  matchPublisherBodyTextSize,
                }),
              staleTime: Infinity,
              gcTime: READER_CHAPTER_ARTIFACTS_GC_MS,
            }))!;

          if (cachedArtifact) cachedArtifactCount += 1;
          else builtArtifactCount += 1;

          const currentSignature =
            signaturesByChapterRef.current.get(chapterIndex);
          const currentArtifact =
            artifactsByChapterRef.current.get(chapterIndex);

          if (currentArtifact && currentSignature === artifactSignature) {
            if (chapterIndex === firstChapterIndex) {
              endFirstArtifact({ cache: "loader-memory" });
            }
            continue;
          }

          if (currentSignature !== previousSignature) continue;

          await ensurePublisherFontsReadyFromBlocks(artifact.blocks);

          artifactsByChapterRef.current.set(chapterIndex, artifact);
          signaturesByChapterRef.current.set(chapterIndex, artifactSignature);

          if (chapterIndex === firstChapterIndex) {
            endFirstArtifact({
              cache: cachedArtifact ? "react-query" : "built",
              blockCount: artifact.blocks.length,
            });
          }

          if (!currentArtifact) {
            notify({ kind: "loaded", chapterIndex, artifact });
            continue;
          }

          if (
            currentSignature !== artifactSignature ||
            didDecoratedChapterBlocksChange(currentArtifact, artifact)
          ) {
            notify({ kind: "updated", chapterIndex, artifact });
          }
        }
        endFirstArtifact({ cache: "not-loaded" });
        endReaderTraceSpan(allArtifactsSpan, {
          cachedArtifactCount,
          builtArtifactCount,
        });
      } catch (error) {
        const details = {
          error: error instanceof Error ? error.message : String(error),
        };
        endReaderTraceSpan(firstArtifactSpan, details, "error");
        endReaderTraceSpan(allArtifactsSpan, details, "error");
        throw error;
      }
    }

    void loadArtifacts();
  }, [
    baseContentByChapter,
    bookId,
    chapterEntries,
    enabled,
    fileHash,
    highlightsBySpineItemId,
    initialLocation,
    matchPublisherBodyTextSize,
    notify,
    publisherBookStylingEnabled,
    queryClient,
  ]);

  const getChapterBlocks = useCallback(
    (chapterIndex: number): ParsedChapterBlocks | null =>
      artifactsByChapterRef.current.get(chapterIndex)?.blocks ?? null,
    [],
  );

  const subscribe = useCallback((listener: ReaderChapterArtifactSubscriber) => {
    listenersRef.current.add(listener);

    for (const artifact of artifactsByChapterRef.current.values()) {
      listener({
        kind: "loaded",
        chapterIndex: artifact.chapterIndex,
        artifact,
      });
    }

    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  return {
    getChapterBlocks,
    subscribe,
  };
}
