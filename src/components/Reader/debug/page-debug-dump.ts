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

export interface ReaderPageDebugDumpElementMetrics {
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  offsetWidth: number;
  offsetHeight: number;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  overflowX: number;
  overflowY: number;
}

export interface ReaderPageDebugDumpEnvironment {
  userAgent: string;
  window: {
    innerWidth: number;
    innerHeight: number;
    outerWidth: number;
    outerHeight: number;
    devicePixelRatio: number;
  };
  visualViewport: {
    width: number;
    height: number;
    offsetTop: number;
    offsetLeft: number;
    pageTop: number;
    pageLeft: number;
    scale: number;
  } | null;
  documentElement: {
    clientWidth: number;
    clientHeight: number;
    scrollWidth: number;
    scrollHeight: number;
  };
  safeAreaInsets: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  stageSlot: ReaderPageDebugDumpElementMetrics | null;
  stageContent: ReaderPageDebugDumpElementMetrics | null;
  pageSlots: Array<{
    slotIndex: number;
    currentPage: number | null;
    metrics: ReaderPageDebugDumpElementMetrics;
    contentMetrics: ReaderPageDebugDumpElementMetrics | null;
    slices: Array<{
      sliceIndex: number;
      type: string;
      blockId: string;
      expectedHeight: number | null;
      lineCount: number | null;
      lineHeight: number | null;
      metrics: ReaderPageDebugDumpElementMetrics;
    }>;
  }>;
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
  environment?: ReaderPageDebugDumpEnvironment;
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
  environment?: ReaderPageDebugDumpEnvironment;
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
  environment,
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
    ...(environment ? { environment } : {}),
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

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function getElementMetrics(
  element: HTMLElement | null,
): ReaderPageDebugDumpElementMetrics | null {
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  return {
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    offsetWidth: element.offsetWidth,
    offsetHeight: element.offsetHeight,
    rect: {
      x: roundMetric(rect.x),
      y: roundMetric(rect.y),
      width: roundMetric(rect.width),
      height: roundMetric(rect.height),
      top: roundMetric(rect.top),
      right: roundMetric(rect.right),
      bottom: roundMetric(rect.bottom),
      left: roundMetric(rect.left),
    },
    overflowX: element.scrollWidth - element.clientWidth,
    overflowY: element.scrollHeight - element.clientHeight,
  };
}

function getSafeAreaInsets() {
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingTop = "env(safe-area-inset-top)";
  probe.style.paddingRight = "env(safe-area-inset-right)";
  probe.style.paddingBottom = "env(safe-area-inset-bottom)";
  probe.style.paddingLeft = "env(safe-area-inset-left)";
  document.body.appendChild(probe);

  const style = window.getComputedStyle(probe);
  const insets = {
    top: Number.parseFloat(style.paddingTop) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
  };

  probe.remove();
  return insets;
}

export function collectReaderPageDebugDumpEnvironment(options: {
  stageSlotElement: HTMLElement | null;
  stageContentElement: HTMLElement | null;
}): ReaderPageDebugDumpEnvironment | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return undefined;
  }

  const { visualViewport } = window;
  const { documentElement } = document;
  const pageSlotElements = Array.from(
    options.stageContentElement?.querySelectorAll<HTMLElement>(
      "[data-reader-page-slot]",
    ) ?? [],
  );

  return {
    userAgent: navigator.userAgent,
    window: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    visualViewport: visualViewport
      ? {
          width: roundMetric(visualViewport.width),
          height: roundMetric(visualViewport.height),
          offsetTop: roundMetric(visualViewport.offsetTop),
          offsetLeft: roundMetric(visualViewport.offsetLeft),
          pageTop: roundMetric(visualViewport.pageTop),
          pageLeft: roundMetric(visualViewport.pageLeft),
          scale: roundMetric(visualViewport.scale),
        }
      : null,
    documentElement: {
      clientWidth: documentElement.clientWidth,
      clientHeight: documentElement.clientHeight,
      scrollWidth: documentElement.scrollWidth,
      scrollHeight: documentElement.scrollHeight,
    },
    safeAreaInsets: getSafeAreaInsets(),
    stageSlot: getElementMetrics(options.stageSlotElement),
    stageContent: getElementMetrics(options.stageContentElement),
    pageSlots: pageSlotElements.flatMap((element) => {
      const metrics = getElementMetrics(element);
      if (!metrics) return [];

      const contentMetrics = getElementMetrics(
        element.querySelector<HTMLElement>("[data-reader-page-content]"),
      );
      const sliceElements = Array.from(
        element.querySelectorAll<HTMLElement>("[data-reader-page-slice]"),
      );

      return [
        {
          slotIndex: Number(element.dataset.readerPageSlot ?? 0),
          currentPage: element.dataset.readerCurrentPage
            ? Number(element.dataset.readerCurrentPage)
            : null,
          metrics,
          contentMetrics,
          slices: sliceElements.flatMap((sliceElement) => {
            const sliceMetrics = getElementMetrics(sliceElement);
            if (!sliceMetrics) return [];

            return [
              {
                sliceIndex: Number(sliceElement.dataset.readerPageSlice ?? 0),
                type: sliceElement.dataset.readerSliceType ?? "unknown",
                blockId: sliceElement.dataset.readerBlockId ?? "",
                expectedHeight: sliceElement.dataset.readerExpectedHeight
                  ? Number(sliceElement.dataset.readerExpectedHeight)
                  : null,
                lineCount: sliceElement.dataset.readerLineCount
                  ? Number(sliceElement.dataset.readerLineCount)
                  : null,
                lineHeight: sliceElement.dataset.readerLineHeight
                  ? Number(sliceElement.dataset.readerLineHeight)
                  : null,
                metrics: sliceMetrics,
              },
            ];
          }),
        },
      ];
    }),
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
