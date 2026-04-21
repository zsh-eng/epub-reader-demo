import { useEffect, useLayoutEffect, useState } from "react";

const COLUMN_GAP_PX = 20;
const MIN_VIEWPORT_WIDTH_PX = 200;
const MIN_VIEWPORT_HEIGHT_PX = 200;
const MAX_VIEWPORT_WIDTH_PX = 1440;
const MAX_VIEWPORT_HEIGHT_PX = 980;

/** Height of the floating header (h-14), inside the safe-area-adjusted root. */
const HEADER_HEIGHT_PX = 56;
/** Visual breathing room between overlay edge and text. */
const MIN_PADDING_Y = 4;
/** Minimum horizontal margin between screen edge and text. */
const MIN_PADDING_X = 20;

// Symmetry in the vertical padding.
// It's ok for the footer to overlap the text - it's not to be shown all the time.
const PADDING_TOP = HEADER_HEIGHT_PX + MIN_PADDING_Y;
const PADDING_BOTTOM = PADDING_TOP;

export interface ReaderStageViewport {
  width: number;
  height: number;
}

export interface ReaderStagePadding {
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
}

interface ReaderStageLayout {
  stageViewport: ReaderStageViewport;
  stagePadding: ReaderStagePadding;
}

interface UsePaginatedReaderLayoutOptions {
  stageSlotElement: HTMLDivElement | null;
  isMobile: boolean;
  spreadColumns: 1 | 2;
  onSpreadColumnsChange?: (columns: 1 | 2) => void;
}

const DEFAULT_STAGE_LAYOUT: ReaderStageLayout = {
  stageViewport: {
    width: 620,
    height: 860,
  },
  stagePadding: {
    paddingX: MIN_PADDING_X,
    paddingTop: PADDING_TOP,
    paddingBottom: PADDING_BOTTOM,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeStageLayout(
  stageSlot: HTMLElement,
  spreadColumns: 1 | 2,
): ReaderStageLayout {
  const availableWidth = Math.max(1, stageSlot.clientWidth);
  const availableHeight = Math.max(1, stageSlot.clientHeight);
  // stageSlot dimensions are safe-area-adjusted
  // (root element handles env(safe-area-inset-*)).

  const paddingTop = PADDING_TOP;
  const paddingBottom = PADDING_BOTTOM;
  const height = clamp(
    availableHeight - paddingTop - paddingBottom,
    MIN_VIEWPORT_HEIGHT_PX,
    MAX_VIEWPORT_HEIGHT_PX,
  );

  const maxContentWidth =
    MAX_VIEWPORT_WIDTH_PX * spreadColumns + COLUMN_GAP_PX * (spreadColumns - 1);
  const contentWidth = Math.min(
    availableWidth - MIN_PADDING_X * 2,
    maxContentWidth,
  );
  const paddingX = Math.max(MIN_PADDING_X, (availableWidth - contentWidth) / 2);
  const width = clamp(
    (contentWidth - COLUMN_GAP_PX * (spreadColumns - 1)) / spreadColumns,
    MIN_VIEWPORT_WIDTH_PX,
    MAX_VIEWPORT_WIDTH_PX,
  );

  return {
    stageViewport: {
      width,
      height,
    },
    stagePadding: {
      paddingX,
      paddingTop,
      paddingBottom,
    },
  };
}

/**
 * Computes the paginated reader's stage layout from the available stage slot.
 * Observes the stage container and derives the stage viewport, stage padding,
 * and effective column behavior used by Reader.
 */
export function usePaginatedReaderLayout({
  stageSlotElement,
  isMobile,
  spreadColumns,
  onSpreadColumnsChange,
}: UsePaginatedReaderLayoutOptions) {
  const [layout, setLayout] = useState(DEFAULT_STAGE_LAYOUT);

  const effectiveSpreadColumns: 1 | 2 = isMobile ? 1 : spreadColumns;

  useEffect(() => {
    if (isMobile && spreadColumns !== 1) {
      onSpreadColumnsChange?.(1);
    }
  }, [isMobile, onSpreadColumnsChange, spreadColumns]);

  useLayoutEffect(() => {
    if (!stageSlotElement) return;

    const updateLayout = () => {
      setLayout(computeStageLayout(stageSlotElement, effectiveSpreadColumns));
    };

    updateLayout();

    const observer = new ResizeObserver(updateLayout);
    observer.observe(stageSlotElement);

    return () => {
      observer.disconnect();
    };
  }, [effectiveSpreadColumns, stageSlotElement]);

  return {
    stageViewport: layout.stageViewport,
    stagePadding: layout.stagePadding,
    effectiveSpreadColumns,
    showColumnSelector: !isMobile,
  };
}
