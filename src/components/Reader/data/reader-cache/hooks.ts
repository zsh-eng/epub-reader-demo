import {
  getCurrentDeviceReadingCheckpoint,
  getReadingCheckpointsForBook,
  type SyncedReadingCheckpoint,
} from "@/lib/db";
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
  ) =>
    [
      "readerBodyCache",
      READER_BODY_CACHE_SCHEMA_VERSION,
      bookId,
      fileHash,
      getPublisherStylingCacheKey(publisherBookStylingEnabled),
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
    ] as const,
};

function getPublisherStylingCacheKey(enabled: boolean): string {
  return enabled ? "publisher-styling-on" : "publisher-styling-off";
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
}) {
  const {
    bookId,
    fileHash,
    chapterEntries,
    publisherBookStylingEnabled,
  } = options;

  return useQuery({
    queryKey: readerBodyCacheKeys.book(
      bookId ?? "",
      fileHash ?? "",
      publisherBookStylingEnabled,
    ),
    queryFn: () =>
      loadReaderBodyCache({
        bookId: bookId!,
        fileHash: fileHash!,
        chapterEntries,
        publisherBookStylingEnabled,
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
      checkpoint: await getCurrentDeviceReadingCheckpoint(bookId!),
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
      checkpoints: await getReadingCheckpointsForBook(bookId!),
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
  } = options;
  const queryClient = useQueryClient();
  const artifactsByChapterRef = useRef<
    Map<number, ReaderDecoratedChapterArtifact>
  >(new Map());
  const signaturesByChapterRef = useRef<Map<number, string>>(new Map());
  const listenersRef = useRef<Set<ReaderChapterArtifactSubscriber>>(
    new Set(),
  );

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
    artifactsByChapterRef.current.clear();
    signaturesByChapterRef.current.clear();
  }, [publisherBookStylingEnabled]);

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
      for (const chapterIndex of buildReaderChapterLoadOrder(
        chapterEntries.length,
        resolvedInitialLocation.chapterIndex,
      )) {
        const chapter = chapterEntries[chapterIndex]!;
        const baseContent = resolvedBaseContentByChapter.get(chapterIndex)!;
        const chapterHighlights =
          highlightsBySpineItemId.get(chapter.spineItemId) ?? [];
        const highlightSignature = buildHighlightSignature(chapterHighlights);
        const artifactSignature = `${getPublisherStylingCacheKey(
          publisherBookStylingEnabled,
        )}:${highlightSignature}`;
        const previousSignature =
          signaturesByChapterRef.current.get(chapterIndex);
        const previousArtifact =
          artifactsByChapterRef.current.get(chapterIndex);

        if (previousArtifact && previousSignature === artifactSignature) {
          continue;
        }

        const queryKey = readerChapterArtifactKeys.chapter(
          resolvedBookId,
          resolvedFileHash,
          chapterIndex,
          chapter.spineItemId,
          highlightSignature,
          publisherBookStylingEnabled,
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
              }),
            staleTime: Infinity,
            gcTime: READER_CHAPTER_ARTIFACTS_GC_MS,
          }))!;

        const currentSignature =
          signaturesByChapterRef.current.get(chapterIndex);
        const currentArtifact =
          artifactsByChapterRef.current.get(chapterIndex);

        if (currentArtifact && currentSignature === artifactSignature) {
          continue;
        }

        if (currentSignature !== previousSignature) {
          continue;
        }

        await ensurePublisherFontsReadyFromBlocks(artifact.blocks);

        artifactsByChapterRef.current.set(chapterIndex, artifact);
        signaturesByChapterRef.current.set(chapterIndex, artifactSignature);

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
    notify,
    publisherBookStylingEnabled,
    queryClient,
  ]);

  const getChapterBlocks = useCallback(
    (chapterIndex: number): ParsedChapterBlocks | null =>
      artifactsByChapterRef.current.get(chapterIndex)?.blocks ?? null,
    [],
  );

  const subscribe = useCallback(
    (listener: ReaderChapterArtifactSubscriber) => {
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
    },
    [],
  );

  return {
    getChapterBlocks,
    subscribe,
  };
}
