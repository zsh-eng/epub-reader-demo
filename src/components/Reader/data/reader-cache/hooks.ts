import {
  getCurrentDeviceReadingCheckpoint,
  type SyncedReadingCheckpoint,
} from "@/lib/db";
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
} from "./cache";

export const readerBodyCacheKeys = {
  book: (bookId: string, fileHash: string) =>
    [
      "readerBodyCache",
      READER_BODY_CACHE_SCHEMA_VERSION,
      bookId,
      fileHash,
    ] as const,
};

export const readerCheckpointKeys = {
  currentDevice: (bookId: string) =>
    ["readingCheckpoint", "currentDevice", bookId] as const,
};

export const readerChapterArtifactKeys = {
  chapter: (
    bookId: string,
    fileHash: string,
    chapterIndex: number,
    spineItemId: string,
    highlightSignature: string,
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
    ] as const,
};

export interface ReaderCheckpointData {
  checkpoint: SyncedReadingCheckpoint | undefined;
}

export function useReaderBodyCacheQuery(options: {
  bookId?: string;
  fileHash?: string;
  chapterEntries: ChapterEntry[];
}) {
  const { bookId, fileHash, chapterEntries } = options;

  return useQuery({
    queryKey: readerBodyCacheKeys.book(bookId ?? "", fileHash ?? ""),
    queryFn: () =>
      loadReaderBodyCache({
        bookId: bookId!,
        fileHash: fileHash!,
        chapterEntries,
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
}): ReaderChapterArtifactsLoader {
  const {
    bookId,
    fileHash,
    chapterEntries,
    baseContentByChapter,
    initialLocation,
    highlights,
    enabled,
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
        const previousSignature =
          signaturesByChapterRef.current.get(chapterIndex);
        const previousArtifact =
          artifactsByChapterRef.current.get(chapterIndex);

        if (previousArtifact && previousSignature === highlightSignature) {
          continue;
        }

        const queryKey = readerChapterArtifactKeys.chapter(
          resolvedBookId,
          resolvedFileHash,
          chapterIndex,
          chapter.spineItemId,
          highlightSignature,
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
              }),
            staleTime: Infinity,
            gcTime: READER_CHAPTER_ARTIFACTS_GC_MS,
          }))!;

        const currentSignature =
          signaturesByChapterRef.current.get(chapterIndex);
        const currentArtifact =
          artifactsByChapterRef.current.get(chapterIndex);

        if (currentArtifact && currentSignature === highlightSignature) {
          continue;
        }

        if (currentSignature !== previousSignature) {
          continue;
        }

        artifactsByChapterRef.current.set(chapterIndex, artifact);
        signaturesByChapterRef.current.set(chapterIndex, highlightSignature);

        if (!currentArtifact) {
          notify({ kind: "loaded", chapterIndex, artifact });
          continue;
        }

        if (didDecoratedChapterBlocksChange(currentArtifact, artifact)) {
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
