import { useBookHighlightsQuery } from "@/hooks/use-highlights-query";
import {
  getCurrentDeviceReadingCheckpoint,
  type SyncedReadingCheckpoint,
} from "@/lib/db";
import { useQuery } from "@tanstack/react-query";
import { buildHighlightsBySpineItemId } from "../../highlight-virtualization";
import type { ReaderInitialLocation } from "../chapter-content-pipeline";
import type { ChapterEntry } from "../../types";
import {
  buildReaderArtifactHighlightSignature,
  buildReaderChapterArtifacts,
  loadReaderBodyCache,
  READER_BODY_CACHE_SCHEMA_VERSION,
  READER_CHAPTER_ARTIFACTS_GC_MS,
  READER_CHAPTER_ARTIFACTS_SCHEMA_VERSION,
  type ReaderBodyCacheData,
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
  book: (bookId: string, fileHash: string, highlightSignature: string) =>
    [
      "readerChapterArtifacts",
      READER_CHAPTER_ARTIFACTS_SCHEMA_VERSION,
      READER_BODY_CACHE_SCHEMA_VERSION,
      bookId,
      fileHash,
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

export function useReaderChapterArtifactsQuery(options: {
  bookId?: string;
  fileHash?: string;
  chapterEntries: ChapterEntry[];
  bodyCacheData: ReaderBodyCacheData | undefined;
  initialLocation: ReaderInitialLocation | null;
}) {
  const { bookId, fileHash, chapterEntries, bodyCacheData, initialLocation } =
    options;
  const highlightsQuery = useBookHighlightsQuery(bookId);
  const bookHighlights = highlightsQuery.data ?? [];
  const highlightSignature =
    buildReaderArtifactHighlightSignature(bookHighlights);

  const query = useQuery({
    queryKey: readerChapterArtifactKeys.book(
      bookId ?? "",
      fileHash ?? "",
      highlightSignature,
    ),
    queryFn: () =>
      buildReaderChapterArtifacts({
        bodyCacheData: bodyCacheData!,
        chapterEntries,
        highlightsBySpineItemId: buildHighlightsBySpineItemId(bookHighlights),
        initialChapterIndex: initialLocation!.chapterIndex,
      }),
    enabled:
      !!bookId &&
      !!fileHash &&
      chapterEntries.length > 0 &&
      !!bodyCacheData &&
      !!initialLocation &&
      highlightsQuery.isSuccess,
    staleTime: Infinity,
    gcTime: READER_CHAPTER_ARTIFACTS_GC_MS,
    // Artifact results are immutable, derived Map/array payloads. When the
    // highlight signature changes, replacing them is cheaper and clearer than
    // asking React Query to structurally diff the parsed reader artifacts.
    structuralSharing: false,
  });

  return {
    ...query,
    bookHighlights,
  };
}
