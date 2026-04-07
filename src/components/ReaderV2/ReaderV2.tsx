import { HighlightToolbarContainer } from "@/components/Reader/HighlightToolbarContainer";
import { useIsMobile } from "@/hooks/use-mobile";
import {
    EPUB_HIGHLIGHT_ACTIVE_CLASS,
    EPUB_HIGHLIGHT_CLASS,
    EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
    EPUB_HIGHLIGHT_GROUP_HOVER_CLASS,
} from "@/types/reader.types";
import {
    createHighlightInteractionManager,
    type HighlightInteractionManager,
} from "@zsh-eng/text-highlighter";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
// PAGE_PADDING_X / PAGE_PADDING_Y kept in AnimatedSpread for debug.tsx; not used here.
import { ReaderController } from "./ReaderController";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { ReaderV2Footer } from "./footer";
import { ReaderV2Header } from "./ReaderV2Header";
import { SpreadStage } from "./SpreadStage";
import { useReaderV2Core } from "./hooks/use-reader-v2-core";

const COLUMN_GAP_PX = 20;
const MIN_VIEWPORT_WIDTH_PX = 200;
const MIN_VIEWPORT_HEIGHT_PX = 200;
const MAX_VIEWPORT_WIDTH_PX = 1440;
const MAX_VIEWPORT_HEIGHT_PX = 980;

/** Height of the floating header (h-14), inside the safe-area-adjusted root. */
const HEADER_HEIGHT_PX = 56;
/** Height of the floating footer (chapter row + page indicator + scrubber), excluding safe-area. */
const TOOLBAR_HEIGHT_PX = 124;
/** Visual breathing room between overlay edge and text. */
const MIN_PADDING_Y = 20;
/** Minimum horizontal margin between screen edge and text. */
const MIN_PADDING_X = 20;

const PADDING_TOP = HEADER_HEIGHT_PX + MIN_PADDING_Y;
const PADDING_BOTTOM = TOOLBAR_HEIGHT_PX;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface ReaderViewport {
  width: number;
  height: number;
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
}

interface ActiveHighlightState {
  id: string;
  position: { x: number; y: number };
}

function computeViewport(
  stageSlot: HTMLElement,
  spreadColumns: 1 | 2,
): ReaderViewport {
  const availableWidth = Math.max(1, stageSlot.clientWidth);
  const availableHeight = Math.max(1, stageSlot.clientHeight);
  // stageSlot dimensions are safe-area-adjusted (root element handles env(safe-area-inset-*))

  // Vertical: fixed overlay heights determine padding
  const paddingTop = PADDING_TOP;
  const paddingBottom = PADDING_BOTTOM;
  const nextHeight = clamp(
    availableHeight - paddingTop - paddingBottom,
    MIN_VIEWPORT_HEIGHT_PX,
    MAX_VIEWPORT_HEIGHT_PX,
  );

  // Horizontal: center content within screen, constrained to max readable width
  const maxContentWidth =
    MAX_VIEWPORT_WIDTH_PX * spreadColumns + COLUMN_GAP_PX * (spreadColumns - 1);
  const contentWidth = Math.min(availableWidth - MIN_PADDING_X * 2, maxContentWidth);
  const paddingX = Math.max(MIN_PADDING_X, (availableWidth - contentWidth) / 2);
  const nextWidth = clamp(
    (contentWidth - COLUMN_GAP_PX * (spreadColumns - 1)) / spreadColumns,
    MIN_VIEWPORT_WIDTH_PX,
    MAX_VIEWPORT_WIDTH_PX,
  );

  return { width: nextWidth, height: nextHeight, paddingX, paddingTop, paddingBottom };
}

export function ReaderV2() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [spreadColumns, setSpreadColumns] = useState<1 | 2>(1);
  const stageSlotRef = useRef<HTMLDivElement>(null);
  const stageContentRef = useRef<HTMLDivElement>(null);
  const highlightManagerRef = useRef<HighlightInteractionManager | null>(null);
  const [viewport, setViewport] = useState<ReaderViewport>({
    width: 620,
    height: 860,
    paddingX: MIN_PADDING_X,
    paddingTop: PADDING_TOP,
    paddingBottom: PADDING_BOTTOM,
  });
  const [activeHighlight, setActiveHighlight] =
    useState<ActiveHighlightState | null>(null);

  const effectiveSpreadColumns: 1 | 2 = isMobile ? 1 : spreadColumns;

  const {
    book,
    isBookLoading,
    settings,
    onUpdateSettings,
    chapterEntries,
    bookHighlights,
    spreadConfig,
    pagination,
    paginationConfig,
    deferredImageCacheRef,
    currentPage,
    totalPages,
    currentChapterIndex,
    chapterStartPages,
  } = useReaderV2Core({
    bookId,
    viewport,
    spreadColumns: effectiveSpreadColumns,
  });

  const visibleSpineItemIds = useMemo(() => {
    if (!pagination.spread) return new Set<string>();

    const ids = new Set<string>();
    const start = pagination.spread.chapterIndexStart;
    const end = pagination.spread.chapterIndexEnd;
    if (start === null || end === null) return ids;

    for (let chapterIndex = start; chapterIndex <= end; chapterIndex++) {
      const chapterEntry = chapterEntries[chapterIndex];
      if (!chapterEntry) continue;
      ids.add(chapterEntry.spineItemId);
    }
    return ids;
  }, [chapterEntries, pagination.spread]);

  const visibleHighlights = useMemo(
    () =>
      bookHighlights.filter((highlight) =>
        visibleSpineItemIds.has(highlight.spineItemId),
      ),
    [bookHighlights, visibleSpineItemIds],
  );

  const activeHighlightData = activeHighlight
    ? bookHighlights.find((highlight) => highlight.id === activeHighlight.id) ?? null
    : null;

  useEffect(() => {
    const container = stageContentRef.current;
    if (!container) return;

    const manager = createHighlightInteractionManager(container, {
      highlightClass: EPUB_HIGHLIGHT_CLASS,
      idAttribute: EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
      hoverClass: EPUB_HIGHLIGHT_GROUP_HOVER_CLASS,
      activeClass: EPUB_HIGHLIGHT_ACTIVE_CLASS,
      onHighlightClick: (id, position) => {
        setActiveHighlight((prev) =>
          prev?.id === id ? null : { id, position },
        );
      },
    });

    highlightManagerRef.current = manager;
    return () => {
      manager.destroy();
      if (highlightManagerRef.current === manager) {
        highlightManagerRef.current = null;
      }
    };
  }, [pagination.spread]);

  useEffect(() => {
    highlightManagerRef.current?.setActiveHighlight(activeHighlight?.id ?? null);
  }, [activeHighlight, pagination.spread]);

  useEffect(() => {
    if (!activeHighlight) return;
    const stillVisible = visibleHighlights.some(
      (highlight) => highlight.id === activeHighlight.id,
    );
    if (!stillVisible) setActiveHighlight(null);
  }, [activeHighlight, visibleHighlights]);

  useLayoutEffect(() => {
    const stageSlot = stageSlotRef.current;
    if (!stageSlot) return;

    const updateViewport = () => {
      const vp = computeViewport(stageSlot, effectiveSpreadColumns);
      setViewport(vp);
    };

    updateViewport();

    const observer = new ResizeObserver(updateViewport);
    observer.observe(stageSlot);

    return () => {
      observer.disconnect();
    };
  }, [effectiveSpreadColumns, isBookLoading]);

  useEffect(() => {
    if (isMobile && spreadColumns !== 1) {
      setSpreadColumns(1);
    }
  }, [isMobile, spreadColumns]);

  const currentPageLabel = useMemo(() => {
    if (totalPages <= 0) return "Page - / -";
    return `Page ${currentPage} / ${totalPages}`;
  }, [currentPage, totalPages]);

  const canGoPrev = currentPage > 1;
  const canGoNext = !(
    pagination.status === "ready" &&
    totalPages > 0 &&
    currentPage >= totalPages
  );

  const onPrevChapter = useCallback(() => {
    if (currentChapterIndex > 0) pagination.goToChapter(currentChapterIndex - 1);
  }, [currentChapterIndex, pagination]);

  const onNextChapter = useCallback(() => {
    if (currentChapterIndex < chapterEntries.length - 1)
      pagination.goToChapter(currentChapterIndex + 1);
  }, [currentChapterIndex, chapterEntries.length, pagination]);

  if (isBookLoading) {
    return <ReaderStateScreen showSpinner title="Loading book" />;
  }

  if (!bookId || !book) {
    return (
      <ReaderStateScreen
        title="Book not found"
        action={{ label: "Back to Library", onClick: () => navigate("/") }}
      />
    );
  }

  return (
    <ReaderController
      onNextPage={pagination.nextSpread}
      onPrevPage={pagination.prevSpread}
      canGoPrev={canGoPrev}
      canGoNext={canGoNext}
      tapNavEnabled={isMobile}
      containerRef={stageSlotRef}
    >
      {({ chromeVisible }) => (
        <div className="relative h-[100dvh] overflow-hidden bg-background text-foreground">
          {/* Reading container — offset by safe-area insets so clientHeight is safe-area-adjusted */}
          <div
            ref={stageSlotRef}
            className="absolute inset-x-0"
            style={{
              top: "env(safe-area-inset-top)",
              bottom: "max(env(safe-area-inset-bottom), 0.625rem)",
            }}
          >
            <SpreadStage
              spread={pagination.spread}
              spreadConfig={spreadConfig}
              columnSpacingPx={COLUMN_GAP_PX}
              paginationConfig={paginationConfig}
              bookId={bookId}
              deferredImageCache={deferredImageCacheRef.current}
              stageContentRef={stageContentRef}
              paddingTopPx={viewport.paddingTop}
              paddingBottomPx={viewport.paddingBottom}
              paddingLeftPx={viewport.paddingX}
              paddingRightPx={viewport.paddingX}
            />
          </div>

          {/* Floating header — paddingTop handles safe-area notch, content is h-14 = 56px */}
          <ReaderV2Header
            chromeVisible={chromeVisible}
            bookTitle={book.title}
            currentPageLabel={currentPageLabel}
            onBackToLibrary={() => navigate("/")}
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            showColumnSelector={!isMobile}
            spreadColumns={spreadColumns}
            onSpreadColumnsChange={setSpreadColumns}
          />

          {/* Floating footer — chapter nav, page indicator, scrubber */}
          <ReaderV2Footer
            chromeVisible={chromeVisible}
            currentPage={currentPage}
            totalPages={totalPages}
            currentChapterIndex={currentChapterIndex}
            chapterEntries={chapterEntries}
            chapterStartPages={chapterStartPages}
            onGoToPage={pagination.goToPage}
            onGoToChapter={pagination.goToChapter}
            onPrevChapter={onPrevChapter}
            onNextChapter={onNextChapter}
          />

          <HighlightToolbarContainer
            bookId={bookId}
            spineItemId={activeHighlightData?.spineItemId ?? undefined}
            highlights={bookHighlights}
            isCreatingHighlight={false}
            creationPosition={{ x: 0, y: 0 }}
            onCreateColorSelect={(_color) => {
              // ReaderV2 creation flow is handled separately.
            }}
            onCreateClose={() => {}}
            activeHighlight={activeHighlight}
            onEditClose={() => setActiveHighlight(null)}
            isNavVisible={chromeVisible}
            onCreateNoteSubmit={undefined}
          />
        </div>
      )}
    </ReaderController>
  );
}
