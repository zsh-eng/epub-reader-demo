import { usePagination } from "@/lib/pagination-v2";
import { useEffect, useRef } from "react";
import type { ChapterEntry } from "../types";
import type {
  ReaderDecoratedChapterArtifact,
  ReaderInitialLocation,
} from "../data/chapter-content-pipeline";

interface UseReaderPaginationFeedOptions {
  pagination: Pick<
    ReturnType<typeof usePagination>,
    "init" | "addChapter" | "updateChapter"
  >;
  chapterEntries: ChapterEntry[];
  artifactsByChapter: (ReaderDecoratedChapterArtifact | null)[];
  initialLocation: ReaderInitialLocation | null;
  loadVersion: number;
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
  chapterEntries,
  artifactsByChapter,
  initialLocation,
  loadVersion,
}: UseReaderPaginationFeedOptions): void {
  const initializedLoadVersionRef = useRef<number | null>(null);
  const sentArtifactsRef = useRef<Map<number, ReaderDecoratedChapterArtifact>>(
    new Map(),
  );
  const { addChapter, init, updateChapter } = pagination;

  useEffect(() => {
    initializedLoadVersionRef.current = null;
    sentArtifactsRef.current = new Map();
  }, [loadVersion]);

  useEffect(() => {
    if (!initialLocation || chapterEntries.length === 0) return;

    const initialArtifact = artifactsByChapter[initialLocation.chapterIndex];
    if (!initialArtifact) return;
    if (initializedLoadVersionRef.current === loadVersion) return;

    init({
      totalChapters: chapterEntries.length,
      initialChapterIndex: initialLocation.chapterIndex,
      initialChapterProgress: initialLocation.chapterProgress,
      intent: initialLocation.isRestore
        ? { kind: "restore" }
        : { kind: "replace" },
      firstChapterBlocks: initialArtifact.blocks,
    });

    initializedLoadVersionRef.current = loadVersion;
    sentArtifactsRef.current = new Map([
      [initialLocation.chapterIndex, initialArtifact],
    ]);
  }, [
    artifactsByChapter,
    chapterEntries.length,
    initialLocation,
    init,
    loadVersion,
  ]);

  useEffect(() => {
    if (!initialLocation) return;
    if (initializedLoadVersionRef.current !== loadVersion) return;

    for (
      let chapterIndex = 0;
      chapterIndex < chapterEntries.length;
      chapterIndex++
    ) {
      const artifact = artifactsByChapter[chapterIndex];
      if (!artifact) continue;

      const previousArtifact = sentArtifactsRef.current.get(chapterIndex);
      if (previousArtifact === artifact) continue;

      if (previousArtifact) {
        updateChapter(chapterIndex, artifact.blocks);
      } else if (chapterIndex !== initialLocation.chapterIndex) {
        addChapter(chapterIndex, artifact.blocks);
      }

      sentArtifactsRef.current.set(chapterIndex, artifact);
    }
  }, [
    artifactsByChapter,
    addChapter,
    chapterEntries.length,
    initialLocation,
    loadVersion,
    updateChapter,
  ]);
}
