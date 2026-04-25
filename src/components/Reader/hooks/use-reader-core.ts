import { useBookLoader } from "@/hooks/use-book-loader";
import { useEpubProcessor } from "@/hooks/use-epub-processor";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import type { Book } from "@/lib/db";
import {
  DEFAULT_PARAGRAPH_SPACING,
  usePagination,
  type Block,
  type ChapterCanonicalText,
  type PaginationConfig,
  type SpreadConfig,
} from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import type { FontFamily, ReaderSettings } from "@/types/reader.types";
import { useCallback, useMemo } from "react";
import type { ChapterEntry } from "../types";
import { resolveReaderEpubPreparation } from "./reader-epub-preparation";
import { useReaderReadingSession } from "./reading-sessions/use-reader-reading-session";
import { usePaginationKeyboardNav } from "./use-pagination-keyboard-nav";
import { useReaderChapterContent } from "./use-reader-chapter-content";
import { useReaderCheckpointController } from "./use-reader-checkpoint-controller";
import { useReaderPaginationFeed } from "./use-reader-pagination-feed";

interface UseReaderCoreOptions {
  bookId?: string;
  viewport: { width: number; height: number };
  spreadColumns: 1 | 2 | 3;
  paragraphSpacingFactor?: number;
}

interface UseReaderCoreResult {
  book: Book | null;
  isBookLoading: boolean;
  epubProcessError: Error | null;
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  chapterEntries: ChapterEntry[];
  bookHighlights: Highlight[];
  spreadConfig: SpreadConfig;
  paginationConfig: PaginationConfig;
  pagination: ReturnType<typeof usePagination>;
  sourceLoadWallClockMs: number | null;
  currentPage: number;
  totalPages: number;
  currentChapterIndex: number;
  currentTitleChapterIndex: number | null;
  /** Start page for each chapter (by chapterIndex), null if not yet laid out. */
  chapterStartPages: (number | null)[];
  getChapterBlocks: (chapterIndex: number) => Block[] | null;
  getChapterCanonicalText: (
    chapterIndex: number,
  ) => ChapterCanonicalText | null;
}

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
      baseSizePx: settings.fontSize,
    },
    layoutTheme: {
      baseFontSizePx: settings.fontSize,
      lineHeightFactor: settings.lineHeight,
      paragraphSpacingFactor,
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

export function useReaderCore(
  options: UseReaderCoreOptions,
): UseReaderCoreResult {
  // Composes the reader's top-level state: settings, chapter content, and pagination.
  const {
    bookId,
    viewport,
    spreadColumns,
    paragraphSpacingFactor = DEFAULT_PARAGRAPH_SPACING,
  } = options;
  const { settings, updateSettings } = useReaderSettings();
  const { book, isLoading: isBookLoading } = useBookLoader(bookId, {
    includeInitialProgress: false,
  });
  const epubProcessor = useEpubProcessor(bookId, book?.fileHash);
  const epubPreparation = resolveReaderEpubPreparation({
    bookId,
    book,
    isBookLoading,
    epubProcessor,
  });

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

  useReaderCheckpointController({
    bookId,
    spread: pagination.spread,
  });

  useReaderReadingSession({
    bookId,
    spread: pagination.spread,
  });

  usePaginationKeyboardNav({
    onPrevSpread: pagination.prevSpread,
    onNextSpread: pagination.nextSpread,
  });

  const {
    chapterEntries,
    bookHighlights,
    artifactsByChapter,
    initialLocation,
    loadVersion,
    sourceLoadWallClockMs,
    getChapterBlocks,
    getChapterCanonicalText,
  } = useReaderChapterContent({
    bookId: epubPreparation.chapterContentBookId,
    book: epubPreparation.chapterContentBook,
  });

  useReaderPaginationFeed({
    pagination,
    chapterEntries,
    artifactsByChapter,
    initialLocation,
    loadVersion,
  });

  const { markFontSwitchIntent } = pagination;
  const onUpdateSettings = useCallback(
    (patch: Partial<ReaderSettings>) => {
      if (patch.fontFamily && patch.fontFamily !== settings.fontFamily) {
        markFontSwitchIntent(settings.fontFamily, patch.fontFamily);
      }
      updateSettings(patch);
    },
    [settings.fontFamily, markFontSwitchIntent, updateSettings],
  );

  const currentPage = pagination.spread?.currentPage ?? 1;
  const totalPages = pagination.spread?.totalPages ?? 0;
  const currentChapterIndex = pagination.spread?.chapterIndexStart ?? 0;
  const currentTitleChapterIndex =
    pagination.spread?.chapterIndexStart ??
    initialLocation?.chapterIndex ??
    null;

  const chapterStartPages = useMemo<(number | null)[]>(() => {
    const result: (number | null)[] = [];
    let runningPage = 1;
    for (let i = 0; i < chapterEntries.length; i++) {
      const count = pagination.chapterPageCounts.get(i);
      if (count === undefined) {
        for (let j = i; j < chapterEntries.length; j++) result.push(null);
        break;
      }
      result.push(runningPage);
      runningPage += count;
    }
    return result;
  }, [chapterEntries.length, pagination.chapterPageCounts]);

  return {
    book,
    isBookLoading: epubPreparation.isBookLoading,
    epubProcessError: epubPreparation.epubProcessError,
    settings,
    onUpdateSettings,
    chapterEntries,
    bookHighlights,
    spreadConfig,
    paginationConfig,
    pagination,
    sourceLoadWallClockMs,
    currentPage,
    totalPages,
    currentChapterIndex,
    currentTitleChapterIndex,
    chapterStartPages,
    getChapterBlocks,
    getChapterCanonicalText,
  };
}
