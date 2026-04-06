import { useBookLoader } from "@/hooks/use-book-loader";
import { useReaderSettings } from "@/hooks/use-reader-settings";
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
import {
  parseChapterHtml,
  usePagination,
  type PaginationConfig,
  type SpreadConfig,
} from "@/lib/pagination-v2";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import type { FontFamily, ReaderSettings } from "@/types/reader.types";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { usePaginationKeyboardNav } from "./use-pagination-keyboard-nav";

export interface ChapterEntry {
  index: number;
  href: string;
  title: string;
}

interface UseReaderV2CoreOptions {
  bookId?: string;
  viewport: { width: number; height: number };
  spreadColumns: 1 | 2 | 3;
  paragraphSpacingFactor?: number;
}

interface UseReaderV2CoreResult {
  book: Book | null;
  isBookLoading: boolean;
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  chapterEntries: ChapterEntry[];
  spreadConfig: SpreadConfig;
  paginationConfig: PaginationConfig;
  pagination: ReturnType<typeof usePagination>;
  deferredImageCacheRef: MutableRefObject<Map<string, string>>;
  sourceLoadWallClockMs: number | null;
  currentPage: number;
  totalPages: number;
  currentChapterIndex: number;
}

const DEFAULT_PARAGRAPH_SPACING = 1.2;

function getNamedBodyFont(fontFamily: FontFamily): string {
  switch (fontFamily) {
    case "sans-serif":
    case "inter":
      return `"Inter", "Helvetica Neue", Arial, sans-serif`;
    case "monospace":
      return `"Courier New", Menlo, Monaco, monospace`;
    case "lora":
      return `"Lora", Georgia, serif`;
    case "iowan":
      return `"Iowan Old Style", "Palatino Linotype", serif`;
    case "garamond":
      return `"EB Garamond", Garamond, serif`;
    case "serif":
    default:
      return `"EB Garamond", Georgia, serif`;
  }
}

function buildPaginationConfig(
  settings: ReaderSettings,
  paragraphSpacingFactor: number,
  viewport: { width: number; height: number },
): PaginationConfig {
  return {
    fontConfig: {
      bodyFamily: getNamedBodyFont(settings.fontFamily),
      headingFamily: getNamedBodyFont(settings.fontFamily),
      codeFamily: `"Courier New", Menlo, Monaco, monospace`,
      baseSizePx: 16 * (settings.fontSize / 100),
    },
    layoutTheme: {
      baseFontSizePx: 16 * (settings.fontSize / 100),
      lineHeightFactor: settings.lineHeight,
      paragraphSpacingFactor,
      headingSpaceAbove: 1.5,
      headingSpaceBelow: 0.7,
      textAlign: settings.textAlign,
    },
    viewport,
  };
}

function buildSpreadConfig(columns: 1 | 2 | 3): SpreadConfig {
  return {
    columns,
    chapterFlow: "continuous",
  };
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

export function useReaderV2Core(
  options: UseReaderV2CoreOptions,
): UseReaderV2CoreResult {
  const {
    bookId,
    viewport,
    spreadColumns,
    paragraphSpacingFactor = DEFAULT_PARAGRAPH_SPACING,
  } = options;
  const { settings, updateSettings } = useReaderSettings();
  const [sourceLoadWallClockMs, setSourceLoadWallClockMs] = useState<
    number | null
  >(null);
  const deferredImageCacheRef = useRef<Map<string, string>>(new Map());
  const { book, isLoading: isBookLoading } = useBookLoader(bookId);

  const chapterEntries = useMemo(() => buildChapterEntries(book), [book]);

  const paginationConfig = useMemo(
    () => buildPaginationConfig(settings, paragraphSpacingFactor, viewport),
    [settings, paragraphSpacingFactor, viewport],
  );

  const spreadConfig = useMemo(
    () => buildSpreadConfig(spreadColumns),
    [spreadColumns],
  );

  const pagination = usePagination({
    paginationConfig,
    spreadConfig,
  });

  usePaginationKeyboardNav({
    onPrevSpread: pagination.prevSpread,
    onNextSpread: pagination.nextSpread,
  });

  const onUpdateSettings = useCallback(
    (patch: Partial<ReaderSettings>) => {
      if (patch.fontFamily && patch.fontFamily !== settings.fontFamily) {
        pagination.markFontSwitchIntent(settings.fontFamily, patch.fontFamily);
      }
      updateSettings(patch);
    },
    [settings.fontFamily, pagination.markFontSwitchIntent, updateSettings],
  );

  useEffect(() => {
    if (!bookId || chapterEntries.length === 0) return;

    let cancelled = false;
    setSourceLoadWallClockMs(null);

    const cleanupAllResources = () => {
      cleanupResourceUrls(deferredImageCacheRef.current);
    };

    const loadAll = async () => {
      const startedAt = performance.now();

      try {
        cleanupAllResources();
        const imageDimensionsByPath = await getBookImageDimensionsMap(bookId);

        const allPaths = chapterEntries.map((chapter) => chapter.href);
        const [firstFile, restFiles] = await Promise.all([
          getBookFile(bookId, chapterEntries[0]!.href),
          getBookFilesByPaths(bookId, allPaths.slice(1)),
        ]);

        if (cancelled) return;

        const firstHtml = await processChapterHtml(
          firstFile,
          chapterEntries[0]!,
          imageDimensionsByPath,
        );
        if (cancelled) return;

        const firstBlocks = parseChapterHtml(firstHtml);
        pagination.init({
          totalChapters: chapterEntries.length,
          initialChapterIndex: 0,
          firstChapterBlocks: firstBlocks,
        });

        for (let i = 1; i < chapterEntries.length; i++) {
          const chapter = chapterEntries[i]!;
          const file = restFiles.get(chapter.href);
          const html = await processChapterHtml(
            file,
            chapter,
            imageDimensionsByPath,
          );
          if (cancelled) return;

          const blocks = parseChapterHtml(html);
          pagination.addChapter(i, blocks);
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

    void loadAll();

    return () => {
      cancelled = true;
      cleanupAllResources();
    };
  }, [bookId, chapterEntries, pagination.addChapter, pagination.init]);

  const currentPage = pagination.spread?.currentPage ?? 1;
  const totalPages = pagination.spread?.totalPages ?? 0;
  const currentChapterIndex = pagination.spread?.chapterIndexStart ?? 0;

  return {
    book,
    isBookLoading,
    settings,
    onUpdateSettings,
    chapterEntries,
    spreadConfig,
    paginationConfig,
    pagination,
    deferredImageCacheRef,
    sourceLoadWallClockMs,
    currentPage,
    totalPages,
    currentChapterIndex,
  };
}
