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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
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

const CHAPTER_ARTIFACT_TASK_BUDGET_MS = 8;
const MAX_RECORDED_CHAPTER_ARTIFACT_YIELDS = 12;

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

function getReaderChapterArtifactSignature(options: {
  highlightSignature: string;
  publisherBookStylingEnabled: boolean;
  matchPublisherBodyTextSize: boolean;
  publisherBodyFontScale: number | undefined;
}): string {
  const {
    highlightSignature,
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
    publisherBodyFontScale,
  } = options;
  return `${getPublisherStylingCacheKey(
    publisherBookStylingEnabled,
  )}:${getPublisherBodySizeCacheKey(
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
    publisherBodyFontScale,
  )}:${highlightSignature}`;
}

function scheduleArtifactTaskProbe(initialChapterIndex: number): void {
  const scheduledAtMs = performance.now();
  const probeSpan = startReaderTraceSpan(
    "chapter-artifacts-event-loop-probe",
    "processing",
    { initialChapterIndex },
  );
  window.setTimeout(() => {
    endReaderTraceSpan(probeSpan, {
      taskDelayMs: Math.round((performance.now() - scheduledAtMs) * 10) / 10,
    });
  }, 0);
}

async function yieldToMainThreadTask(): Promise<void> {
  const browserScheduler = (
    globalThis as {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (browserScheduler?.yield) {
    await browserScheduler.yield();
    return;
  }

  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
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

export function useReaderCheckpointsQuery(
  bookId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: readerCheckpointKeys.book(bookId ?? ""),
    queryFn: async (): Promise<ReaderCheckpointsData> => ({
      checkpoints: await withReaderTraceSpan(
        "reading-checkpoints-read",
        "storage",
        () => getReadingCheckpointsForBook(bookId!),
      ),
    }),
    enabled: !!bookId && enabled,
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
  resumeBackgroundLoad: () => void;
}

/**
 * Keeps decorated reader artifacts out of React render data. Highlight changes
 * update the relevant chapter cache row and notify subscribers imperatively.
 * Startup builds the initial chapter first. It waits for the first spread to
 * commit before it loads the remaining chapters in bounded main-thread tasks.
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
  const backgroundLoadAllowedRef = useRef(false);
  const backgroundLoadWaitersRef = useRef<Set<() => void>>(new Set());
  const activeBookIdRef = useRef<string | undefined>(undefined);

  const highlightsBySpineItemId = useMemo(
    () => buildHighlightsBySpineItemId(highlights),
    [highlights],
  );

  const notify = useCallback((event: ReaderChapterArtifactEvent) => {
    for (const listener of listenersRef.current) listener(event);
  }, []);

  const resumeBackgroundLoad = useCallback(() => {
    backgroundLoadAllowedRef.current = true;
    for (const resolve of backgroundLoadWaitersRef.current) resolve();
    backgroundLoadWaitersRef.current.clear();
  }, []);

  const waitForBackgroundLoad = useCallback(async () => {
    if (backgroundLoadAllowedRef.current) return;
    await new Promise<void>((resolve) => {
      backgroundLoadWaitersRef.current.add(resolve);
    });
  }, []);

  useLayoutEffect(() => {
    if (activeBookIdRef.current !== bookId) {
      for (const resolve of backgroundLoadWaitersRef.current) resolve();
      backgroundLoadWaitersRef.current.clear();
      backgroundLoadAllowedRef.current = false;
      artifactsByChapterRef.current.clear();
      signaturesByChapterRef.current.clear();
      listenersRef.current.clear();
      activeBookIdRef.current = bookId;
    }

    if (
      !enabled ||
      !bookId ||
      !fileHash ||
      !baseContentByChapter ||
      !initialLocation
    ) {
      return;
    }

    const chapterIndex = initialLocation.chapterIndex;
    if (artifactsByChapterRef.current.has(chapterIndex)) return;

    const chapter = chapterEntries[chapterIndex];
    const baseContent = baseContentByChapter.get(chapterIndex);
    if (!chapter || !baseContent) return;

    const chapterHighlights =
      highlightsBySpineItemId.get(chapter.spineItemId) ?? [];
    const highlightSignature = buildHighlightSignature(chapterHighlights);
    const artifactSignature = getReaderChapterArtifactSignature({
      highlightSignature,
      publisherBookStylingEnabled,
      matchPublisherBodyTextSize,
      publisherBodyFontScale: baseContent.publisherBodyFontScale,
    });
    const queryKey = readerChapterArtifactKeys.chapter(
      bookId,
      fileHash,
      chapterIndex,
      chapter.spineItemId,
      highlightSignature,
      publisherBookStylingEnabled,
      matchPublisherBodyTextSize,
      baseContent.publisherBodyFontScale,
    );
    const cachedArtifact =
      queryClient.getQueryData<ReaderDecoratedChapterArtifact>(queryKey);
    if (!cachedArtifact) return;

    artifactsByChapterRef.current.set(chapterIndex, cachedArtifact);
    signaturesByChapterRef.current.set(chapterIndex, artifactSignature);
  }, [
    baseContentByChapter,
    bookId,
    chapterEntries,
    enabled,
    fileHash,
    highlightsBySpineItemId,
    initialLocation,
    matchPublisherBodyTextSize,
    publisherBookStylingEnabled,
    queryClient,
  ]);

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
      let taskSliceStartedAtMs = performance.now();
      let maxTaskSliceMs = 0;
      let taskYieldCount = 0;
      let recordedTaskYieldCount = 0;
      let totalTaskYieldWaitMs = 0;
      let revealGateWaitMs = 0;

      const endFirstArtifact = (
        details: Record<string, string | number | boolean>,
      ) => {
        if (firstArtifactEnded) return;
        firstArtifactEnded = true;
        endReaderTraceSpan(firstArtifactSpan, details);
      };

      try {
        for (
          let loadIndex = 0;
          loadIndex < chapterLoadOrder.length;
          loadIndex += 1
        ) {
          const chapterIndex = chapterLoadOrder[loadIndex]!;
          if (loadIndex === 1) {
            const gateStartedAtMs = performance.now();
            const gateSpan = startReaderTraceSpan(
              "chapter-artifacts-reveal-gate",
              "processing",
              { afterChapterIndex: firstChapterIndex ?? 0 },
            );
            await waitForBackgroundLoad();
            revealGateWaitMs = performance.now() - gateStartedAtMs;
            endReaderTraceSpan(gateSpan, {
              waitMs: Math.round(revealGateWaitMs * 10) / 10,
            });
            taskSliceStartedAtMs = performance.now();
          } else if (
            loadIndex > 1 &&
            performance.now() - taskSliceStartedAtMs >=
              CHAPTER_ARTIFACT_TASK_BUDGET_MS
          ) {
            const taskSliceMs = performance.now() - taskSliceStartedAtMs;
            maxTaskSliceMs = Math.max(maxTaskSliceMs, taskSliceMs);
            const shouldRecordYield =
              recordedTaskYieldCount < MAX_RECORDED_CHAPTER_ARTIFACT_YIELDS;
            const yieldSpan = shouldRecordYield
              ? startReaderTraceSpan(
                  "chapter-artifacts-task-yield",
                  "processing",
                  {
                    afterChapterIndex: chapterLoadOrder[loadIndex - 1]!,
                    taskSliceMs: Math.round(taskSliceMs * 10) / 10,
                  },
                )
              : null;
            const yieldStartedAtMs = performance.now();
            await yieldToMainThreadTask();
            const yieldWaitMs = performance.now() - yieldStartedAtMs;
            taskYieldCount += 1;
            totalTaskYieldWaitMs += yieldWaitMs;
            if (shouldRecordYield) {
              recordedTaskYieldCount += 1;
              endReaderTraceSpan(yieldSpan, {
                waitMs: Math.round(yieldWaitMs * 10) / 10,
              });
            }
            taskSliceStartedAtMs = performance.now();
          }

          const chapter = chapterEntries[chapterIndex]!;
          const baseContent = resolvedBaseContentByChapter.get(chapterIndex)!;
          const chapterHighlights =
            highlightsBySpineItemId.get(chapter.spineItemId) ?? [];
          const highlightSignature = buildHighlightSignature(chapterHighlights);
          const artifactSignature = getReaderChapterArtifactSignature({
            highlightSignature,
            publisherBookStylingEnabled,
            matchPublisherBodyTextSize,
            publisherBodyFontScale: baseContent.publisherBodyFontScale,
          });
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
            if (chapterIndex === firstChapterIndex) {
              scheduleArtifactTaskProbe(chapterIndex);
            }
            continue;
          }

          if (
            currentSignature !== artifactSignature ||
            didDecoratedChapterBlocksChange(currentArtifact, artifact)
          ) {
            notify({ kind: "updated", chapterIndex, artifact });
          }
        }
        maxTaskSliceMs = Math.max(
          maxTaskSliceMs,
          performance.now() - taskSliceStartedAtMs,
        );
        endFirstArtifact({ cache: "not-loaded" });
        endReaderTraceSpan(allArtifactsSpan, {
          cachedArtifactCount,
          builtArtifactCount,
          revealGateWaitMs: Math.round(revealGateWaitMs * 10) / 10,
          taskYieldCount,
          taskYieldWaitMs: Math.round(totalTaskYieldWaitMs * 10) / 10,
          maxTaskSliceMs: Math.round(maxTaskSliceMs * 10) / 10,
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
    waitForBackgroundLoad,
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
    resumeBackgroundLoad,
  };
}
