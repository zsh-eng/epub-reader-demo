import { useBookHighlightsQuery } from "@/hooks/use-highlights-query";
import {
  getBookFile,
  getBookFilesByPaths,
  getBookImageDimensionsMap,
  type Book,
  type BookFile,
} from "@/lib/db";
import {
  cleanupResourceUrls,
  processEmbeddedResources,
} from "@/lib/epub-resource-utils";
import { parseChapterHtml } from "@/lib/pagination-v2";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import type { Highlight } from "@/types/highlight";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import {
  applyChapterHighlights,
  buildHighlightSignature,
  buildHighlightsBySpineItemId,
  type VirtualChapterSource,
} from "../highlight-virtualization";
import type { ChapterEntry } from "../types";

type ParsedChapterBlocks = ReturnType<typeof parseChapterHtml>;

interface LoadedChapterSource {
  source: VirtualChapterSource;
  blocks: ParsedChapterBlocks;
  highlightSignature: string;
}

interface UseReaderV2ChapterSourcesOptions {
  bookId?: string;
  book: Book | null;
  initializePagination: (options: {
    totalChapters: number;
    initialChapterIndex: number;
    firstChapterBlocks: ParsedChapterBlocks;
  }) => void;
  addPaginationChapter: (
    chapterIndex: number,
    blocks: ParsedChapterBlocks,
  ) => void;
  updatePaginationChapter: (
    chapterIndex: number,
    blocks: ParsedChapterBlocks,
  ) => void;
}

interface UseReaderV2ChapterSourcesResult {
  chapterEntries: ChapterEntry[];
  bookHighlights: Highlight[];
  deferredImageCacheRef: RefObject<Map<string, string>>;
  sourceLoadWallClockMs: number | null;
}

function buildChapterEntries(book: Book | null): ChapterEntry[] {
  if (!book) return [];

  return book.spine
    .map((_, index) => {
      const spineItem = book.spine[index];
      if (!spineItem) return null;

      const manifestItem = book.manifest.find(
        (item) => item.id === spineItem.idref,
      );
      if (!manifestItem?.href) return null;

      return {
        index,
        spineItemId: spineItem.idref,
        href: manifestItem.href,
        title: getChapterTitleFromSpine(book, index) || `Chapter ${index + 1}`,
      };
    })
    .filter((chapter): chapter is ChapterEntry => Boolean(chapter));
}

async function processChapterHtml(
  chapterFile: BookFile | undefined,
  chapter: ChapterEntry,
  imageDimensionsByPath: Map<string, { width: number; height: number }>,
): Promise<string> {
  if (!chapterFile) return "";

  const text = await chapterFile.content.text();
  const { document: chapterDoc } = await processEmbeddedResources({
    content: text,
    mediaType: chapterFile.mediaType,
    basePath: chapter.href,
    loadResource: async () => null,
    skipImages: true,
    loadLinkedResources: false,
    imageDimensionsByPath,
  });

  return chapterDoc.querySelector("body")?.innerHTML ?? "";
}

function getChapterHighlights(
  chapter: ChapterEntry,
  highlightsBySpineItemId: ReadonlyMap<string, Highlight[]>,
): Highlight[] {
  return highlightsBySpineItemId.get(chapter.spineItemId) ?? [];
}

function storeLoadedChapterSource(
  chapterIndex: number,
  loadedChapter: LoadedChapterSource,
  chapterSourcesRef: MutableRefObject<Map<number, VirtualChapterSource>>,
  chapterHighlightSignaturesRef: MutableRefObject<Map<number, string>>,
) {
  chapterSourcesRef.current.set(chapterIndex, loadedChapter.source);
  chapterHighlightSignaturesRef.current.set(
    chapterIndex,
    loadedChapter.highlightSignature,
  );
}

async function loadChapterSource(options: {
  chapterFile: BookFile | undefined;
  chapter: ChapterEntry;
  imageDimensionsByPath: Map<string, { width: number; height: number }>;
  highlightsBySpineItemId: ReadonlyMap<string, Highlight[]>;
}): Promise<LoadedChapterSource> {
  const {
    chapterFile,
    chapter,
    imageDimensionsByPath,
    highlightsBySpineItemId,
  } = options;

  const html = await processChapterHtml(
    chapterFile,
    chapter,
    imageDimensionsByPath,
  );
  const chapterHighlights = getChapterHighlights(
    chapter,
    highlightsBySpineItemId,
  );
  const source = applyChapterHighlights(
    { html, highlightedHtml: html },
    chapterHighlights,
  );

  return {
    source,
    blocks: parseChapterHtml(source.highlightedHtml),
    highlightSignature: buildHighlightSignature(chapterHighlights),
  };
}

function pruneRemovedChapterSources(
  chapterEntries: ChapterEntry[],
  chapterSourcesRef: MutableRefObject<Map<number, VirtualChapterSource>>,
  chapterHighlightSignaturesRef: MutableRefObject<Map<number, string>>,
) {
  const validChapterIndices = new Set(
    chapterEntries.map((_, chapterIndex) => chapterIndex),
  );

  for (const [chapterIndex] of chapterSourcesRef.current) {
    if (validChapterIndices.has(chapterIndex)) continue;

    chapterSourcesRef.current.delete(chapterIndex);
    chapterHighlightSignaturesRef.current.delete(chapterIndex);
  }
}

export function useReaderV2ChapterSources({
  bookId,
  book,
  initializePagination,
  addPaginationChapter,
  updatePaginationChapter,
}: UseReaderV2ChapterSourcesOptions): UseReaderV2ChapterSourcesResult {
  const [sourceLoadWallClockMs, setSourceLoadWallClockMs] = useState<
    number | null
  >(null);
  const deferredImageCacheRef = useRef<Map<string, string>>(new Map());
  const chapterSourcesRef = useRef<Map<number, VirtualChapterSource>>(
    new Map(),
  );
  const chapterHighlightSignaturesRef = useRef<Map<number, string>>(new Map());

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

  useEffect(() => {
    if (!bookId || chapterEntries.length === 0) return;

    let cancelled = false;
    setSourceLoadWallClockMs(null);
    chapterSourcesRef.current.clear();
    chapterHighlightSignaturesRef.current.clear();

    const clearDeferredResources = () => {
      cleanupResourceUrls(deferredImageCacheRef.current);
    };

    const loadAllChapterSources = async () => {
      const startedAt = performance.now();

      try {
        clearDeferredResources();
        const imageDimensionsByPath = await getBookImageDimensionsMap(bookId);

        const chapterPaths = chapterEntries.map((chapter) => chapter.href);
        const [firstChapterFile, remainingChapterFiles] = await Promise.all([
          getBookFile(bookId, chapterEntries[0]!.href),
          getBookFilesByPaths(bookId, chapterPaths.slice(1)),
        ]);
        if (cancelled) return;

        const firstLoadedChapter = await loadChapterSource({
          chapterFile: firstChapterFile,
          chapter: chapterEntries[0]!,
          imageDimensionsByPath,
          highlightsBySpineItemId: highlightsBySpineItemIdRef.current,
        });
        if (cancelled) return;

        storeLoadedChapterSource(
          0,
          firstLoadedChapter,
          chapterSourcesRef,
          chapterHighlightSignaturesRef,
        );
        initializePagination({
          totalChapters: chapterEntries.length,
          initialChapterIndex: 0,
          firstChapterBlocks: firstLoadedChapter.blocks,
        });

        for (
          let chapterIndex = 1;
          chapterIndex < chapterEntries.length;
          chapterIndex++
        ) {
          const chapter = chapterEntries[chapterIndex]!;
          const loadedChapter = await loadChapterSource({
            chapterFile: remainingChapterFiles.get(chapter.href),
            chapter,
            imageDimensionsByPath,
            highlightsBySpineItemId: highlightsBySpineItemIdRef.current,
          });
          if (cancelled) return;

          storeLoadedChapterSource(
            chapterIndex,
            loadedChapter,
            chapterSourcesRef,
            chapterHighlightSignaturesRef,
          );
          addPaginationChapter(chapterIndex, loadedChapter.blocks);
        }

        if (!cancelled) {
          setSourceLoadWallClockMs(performance.now() - startedAt);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[ReaderV2] Failed to load chapters", error);
        }
      }
    };

    void loadAllChapterSources();

    return () => {
      cancelled = true;
      clearDeferredResources();
    };
  }, [bookId, chapterEntries, addPaginationChapter, initializePagination]);

  useEffect(() => {
    if (!bookId || chapterEntries.length === 0) return;

    pruneRemovedChapterSources(
      chapterEntries,
      chapterSourcesRef,
      chapterHighlightSignaturesRef,
    );

    for (const [chapterIndex, chapter] of chapterEntries.entries()) {
      const source = chapterSourcesRef.current.get(chapterIndex);
      if (!source) continue;

      const chapterHighlights = getChapterHighlights(
        chapter,
        highlightsBySpineItemId,
      );
      const nextSignature = buildHighlightSignature(chapterHighlights);
      const previousSignature =
        chapterHighlightSignaturesRef.current.get(chapterIndex);
      if (previousSignature === nextSignature) continue;

      const nextSource = applyChapterHighlights(source, chapterHighlights);
      const nextBlocks = parseChapterHtml(nextSource.highlightedHtml);
      storeLoadedChapterSource(
        chapterIndex,
        {
          source: nextSource,
          blocks: nextBlocks,
          highlightSignature: nextSignature,
        },
        chapterSourcesRef,
        chapterHighlightSignaturesRef,
      );

      if (nextSource.highlightedHtml === source.highlightedHtml) continue;

      updatePaginationChapter(chapterIndex, nextBlocks);
    }
  }, [bookId, chapterEntries, highlightsBySpineItemId, updatePaginationChapter]);

  return {
    chapterEntries,
    bookHighlights,
    deferredImageCacheRef,
    sourceLoadWallClockMs,
  };
}
