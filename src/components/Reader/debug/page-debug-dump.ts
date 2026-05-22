import type { Book } from "@/lib/db";
import type {
  Block,
  PaginationConfig,
  ResolvedSpread,
  SpreadConfig,
} from "@/lib/pagination-v2";
import type { ReaderSettings } from "@/types/reader.types";
import type { ChapterEntry } from "../types";

export const READER_PAGE_DEBUG_DUMP_VERSION = 1;

export interface ReaderPageDebugDumpLayout {
  viewport: { width: number; height: number };
  spreadColumns: 1 | 2 | 3;
  columnGapPx: number;
  paddingTopPx: number;
  paddingBottomPx: number;
  paddingLeftPx: number;
  paddingRightPx: number;
}

export interface ReaderPageDebugDump {
  version: typeof READER_PAGE_DEBUG_DUMP_VERSION;
  capturedAt: string;
  book: {
    id: string;
    title: string;
  };
  page: {
    currentPage: number;
    currentSpread: number;
    totalPages: number;
    chapterIndexStart: number | null;
    chapterIndexEnd: number | null;
  };
  layout: ReaderPageDebugDumpLayout;
  settings: ReaderSettings;
  paginationConfig: PaginationConfig;
  spreadConfig: SpreadConfig;
  renderedSpread: ResolvedSpread;
  layoutInputs: Array<{
    chapterIndex: number;
    chapterTitle: string;
    blocks: Block[];
  }>;
}

interface BuildReaderPageDebugDumpOptions {
  book: Book;
  settings: ReaderSettings;
  spread: ResolvedSpread;
  paginationConfig: PaginationConfig;
  spreadConfig: SpreadConfig;
  layout: ReaderPageDebugDumpLayout;
  chapterEntries: ChapterEntry[];
  getBlocks: (chapterIndex: number) => Block[] | null;
}

function getVisibleChapterIndices(spread: ResolvedSpread): number[] {
  const indices = new Set<number>();

  for (const slot of spread.slots) {
    if (slot.kind === "page") {
      indices.add(slot.page.chapterIndex);
    }
  }

  return [...indices].sort((a, b) => a - b);
}

/**
 * Captures both the rendered page slices and the source blocks that produced
 * them so wrapping issues can be reproduced either as a frozen render or as a
 * fresh pagination run from the same inputs.
 */
export function buildReaderPageDebugDump({
  book,
  settings,
  spread,
  paginationConfig,
  spreadConfig,
  layout,
  chapterEntries,
  getBlocks,
}: BuildReaderPageDebugDumpOptions): ReaderPageDebugDump {
  return {
    version: READER_PAGE_DEBUG_DUMP_VERSION,
    capturedAt: new Date().toISOString(),
    book: {
      id: book.id,
      title: book.title,
    },
    page: {
      currentPage: spread.currentPage,
      currentSpread: spread.currentSpread,
      totalPages: spread.totalPages,
      chapterIndexStart: spread.chapterIndexStart,
      chapterIndexEnd: spread.chapterIndexEnd,
    },
    layout,
    settings,
    paginationConfig,
    spreadConfig,
    renderedSpread: spread,
    layoutInputs: getVisibleChapterIndices(spread).map((chapterIndex) => ({
      chapterIndex,
      chapterTitle:
        chapterEntries[chapterIndex]?.title || `Chapter ${chapterIndex + 1}`,
      blocks: getBlocks(chapterIndex) ?? [],
    })),
  };
}

export function serializeReaderPageDebugDump(
  dump: ReaderPageDebugDump,
): string {
  return JSON.stringify(dump, null, 2);
}

export function parseReaderPageDebugDump(
  value: string,
): ReaderPageDebugDump {
  const parsed = JSON.parse(value) as Partial<ReaderPageDebugDump>;

  if (parsed.version !== READER_PAGE_DEBUG_DUMP_VERSION) {
    throw new Error("Unsupported reader debug dump version.");
  }

  if (
    !parsed.book ||
    !parsed.layout ||
    !parsed.paginationConfig ||
    !parsed.spreadConfig ||
    !parsed.renderedSpread ||
    !Array.isArray(parsed.layoutInputs)
  ) {
    throw new Error("Debug dump is missing required reader data.");
  }

  return parsed as ReaderPageDebugDump;
}
