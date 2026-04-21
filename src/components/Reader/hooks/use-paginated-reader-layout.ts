import { useLayoutEffect, useState } from "react";

const MIN_PAGE_WIDTH_PX = 200;
const MAX_PAGE_WIDTH_PX = 1440;
const MIN_PAGE_HEIGHT_PX = 200;
const MAX_PAGE_HEIGHT_PX = 980;
const MAX_SINGLE_PAGE_WIDTH_PX = 680;
const PREFERRED_SPREAD_PAGE_WIDTH_PX = 600;
const MIN_AUTO_SPREAD_PAGE_WIDTH_PX = 420;
const MIN_SPREAD_PAGE_HEIGHT_PX = 520;
const PREFERRED_OUTER_MARGIN_PX = 56;
const MIN_OUTER_MARGIN_PX = 24;
const COLUMN_GAP_PX = 72;
const TOP_RAIL_HEIGHT_PX = 48;
const BOTTOM_RAIL_HEIGHT_PX = 48;
const RAIL_PADDING_BUFFER_PX = 8;

export interface ReaderStageViewport {
  width: number;
  height: number;
}

export interface ReaderStagePadding {
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
}

export interface PaginatedReaderLayout {
  resolvedSpreadColumns: 1 | 2;
  stageViewport: ReaderStageViewport;
  stagePadding: ReaderStagePadding;
  topRailHeight: number;
  bottomRailHeight: number;
  columnGapPx: number;
}

interface ResolvePaginatedReaderLayoutOptions {
  stageWidth: number;
  stageHeight: number;
  isMobile: boolean;
}

interface UsePaginatedReaderLayoutOptions {
  stageSlotElement: HTMLDivElement | null;
  isMobile: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveSpreadColumns(options: {
  stageWidth: number;
  pageHeight: number;
  isMobile: boolean;
}): 1 | 2 {
  const { stageWidth, pageHeight, isMobile } = options;
  if (isMobile) return 1;

  const preferredMarginSpreadWidth =
    (stageWidth - COLUMN_GAP_PX - PREFERRED_OUTER_MARGIN_PX * 2) / 2;
  const autoSpreadFits =
    pageHeight >= MIN_SPREAD_PAGE_HEIGHT_PX &&
    preferredMarginSpreadWidth >= MIN_AUTO_SPREAD_PAGE_WIDTH_PX;

  return autoSpreadFits ? 2 : 1;
}

export function getDefaultPaginatedReaderLayout(): PaginatedReaderLayout {
  return {
    resolvedSpreadColumns: 1,
    stageViewport: {
      width: 620,
      height: 860,
    },
    stagePadding: {
      paddingX: PREFERRED_OUTER_MARGIN_PX,
      paddingTop: TOP_RAIL_HEIGHT_PX + RAIL_PADDING_BUFFER_PX,
      paddingBottom: BOTTOM_RAIL_HEIGHT_PX + RAIL_PADDING_BUFFER_PX,
    },
    topRailHeight: TOP_RAIL_HEIGHT_PX,
    bottomRailHeight: BOTTOM_RAIL_HEIGHT_PX,
    columnGapPx: COLUMN_GAP_PX,
  };
}

/**
 * Resolves the paginated reading stage from the available safe-area-adjusted
 * stage slot. Vertical spacing is based on the hover rails rather than the
 * visible chrome height so the reading measure remains stable as chrome UX
 * evolves.
 */
export function resolvePaginatedReaderLayout(
  options: ResolvePaginatedReaderLayoutOptions,
): PaginatedReaderLayout {
  const availableWidth = Math.max(1, options.stageWidth);
  const availableHeight = Math.max(1, options.stageHeight);
  const topRailHeight = TOP_RAIL_HEIGHT_PX;
  const bottomRailHeight = BOTTOM_RAIL_HEIGHT_PX;
  const paddingTop = topRailHeight + RAIL_PADDING_BUFFER_PX;
  const paddingBottom = bottomRailHeight + RAIL_PADDING_BUFFER_PX;
  const pageHeight = clamp(
    availableHeight - paddingTop - paddingBottom,
    MIN_PAGE_HEIGHT_PX,
    MAX_PAGE_HEIGHT_PX,
  );
  const resolvedSpreadColumns = resolveSpreadColumns({
    stageWidth: availableWidth,
    pageHeight,
    isMobile: options.isMobile,
  });

  if (resolvedSpreadColumns === 1) {
    const pageWidth = clamp(
      Math.min(
        MAX_SINGLE_PAGE_WIDTH_PX,
        Math.max(MIN_PAGE_WIDTH_PX, availableWidth - MIN_OUTER_MARGIN_PX * 2),
      ),
      MIN_PAGE_WIDTH_PX,
      MAX_PAGE_WIDTH_PX,
    );

    return {
      resolvedSpreadColumns,
      stageViewport: {
        width: pageWidth,
        height: pageHeight,
      },
      stagePadding: {
        paddingX: Math.max(
          MIN_OUTER_MARGIN_PX,
          (availableWidth - pageWidth) / 2,
        ),
        paddingTop,
        paddingBottom,
      },
      topRailHeight,
      bottomRailHeight,
      columnGapPx: COLUMN_GAP_PX,
    };
  }

  const preferredSpreadPageWidth =
    (availableWidth - COLUMN_GAP_PX - PREFERRED_OUTER_MARGIN_PX * 2) / 2;
  const pageWidth = clamp(
    Math.min(PREFERRED_SPREAD_PAGE_WIDTH_PX, preferredSpreadPageWidth),
    MIN_AUTO_SPREAD_PAGE_WIDTH_PX,
    MAX_PAGE_WIDTH_PX,
  );

  return {
    resolvedSpreadColumns,
    stageViewport: {
      width: pageWidth,
      height: pageHeight,
    },
    stagePadding: {
      paddingX: Math.max(
        PREFERRED_OUTER_MARGIN_PX,
        (availableWidth - (pageWidth * 2 + COLUMN_GAP_PX)) / 2,
      ),
      paddingTop,
      paddingBottom,
    },
    topRailHeight,
    bottomRailHeight,
    columnGapPx: COLUMN_GAP_PX,
  };
}

/**
 * Observes the paginated reader's stage slot and keeps the derived viewport and
 * rail-based padding in sync with the available space.
 */
export function usePaginatedReaderLayout({
  stageSlotElement,
  isMobile,
}: UsePaginatedReaderLayoutOptions) {
  const [layout, setLayout] = useState(getDefaultPaginatedReaderLayout);

  useLayoutEffect(() => {
    if (!stageSlotElement) return;

    const updateLayout = () => {
      setLayout(
        resolvePaginatedReaderLayout({
          stageWidth: stageSlotElement.clientWidth,
          stageHeight: stageSlotElement.clientHeight,
          isMobile,
        }),
      );
    };

    updateLayout();

    const observer = new ResizeObserver(updateLayout);
    observer.observe(stageSlotElement);

    return () => {
      observer.disconnect();
    };
  }, [isMobile, stageSlotElement]);

  return layout;
}
