import { HighlightToolbarContainer } from "@/components/Reader/HighlightToolbarContainer";
import { useAddHighlightMutation } from "@/hooks/use-highlights-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { isExternalHref, splitHrefFragment } from "@/lib/epub-resource-utils";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
// PAGE_PADDING_X / PAGE_PADDING_Y kept in AnimatedSpread for debug.tsx; not used here.
import { ReaderControlMenu } from "./ReaderControlMenu";
import { ReaderController } from "./ReaderController";
import { ReaderSettingsSheet } from "./ReaderSettingsSheet";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { ReaderV2Header } from "./ReaderV2Header";
import { SpreadStage } from "./SpreadStage";
import { ReaderV2Footer } from "./footer";
import { useReaderActiveHighlight } from "./hooks/use-reader-active-highlight";
import { useReaderV2Core } from "./hooks/use-reader-v2-core";
import { useReaderTextSelection } from "./hooks/use-reader-text-selection";
import { resolvePaginatedLinkTarget } from "./link-navigation";

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

// Symmetry in the vertical padding
// It's ok for the footer to overlap the text - it's not to be shown all the time
const PADDING_TOP = HEADER_HEIGHT_PX + MIN_PADDING_Y;
const PADDING_BOTTOM = PADDING_TOP;

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
  const contentWidth = Math.min(
    availableWidth - MIN_PADDING_X * 2,
    maxContentWidth,
  );
  const paddingX = Math.max(MIN_PADDING_X, (availableWidth - contentWidth) / 2);
  const nextWidth = clamp(
    (contentWidth - COLUMN_GAP_PX * (spreadColumns - 1)) / spreadColumns,
    MIN_VIEWPORT_WIDTH_PX,
    MAX_VIEWPORT_WIDTH_PX,
  );

  return {
    width: nextWidth,
    height: nextHeight,
    paddingX,
    paddingTop,
    paddingBottom,
  };
}

export function ReaderV2() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [spreadColumns, setSpreadColumns] = useState<1 | 2>(1);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const stageSlotRef = useRef<HTMLDivElement>(null);
  const stageContentRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ReaderViewport>({
    width: 620,
    height: 860,
    paddingX: MIN_PADDING_X,
    paddingTop: PADDING_TOP,
    paddingBottom: PADDING_BOTTOM,
  });

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
    currentTitleChapterIndex,
    chapterStartPages,
    getChapterBlocks,
  } = useReaderV2Core({
    bookId,
    viewport,
    spreadColumns: effectiveSpreadColumns,
  });

  const addHighlightMutation = useAddHighlightMutation(bookId);

  const { activeHighlight, activeHighlightData, clearActiveHighlight } =
    useReaderActiveHighlight({
      spread: pagination.spread,
      stageContentRef,
      chapterEntries,
      bookHighlights,
    });

  const {
    showHighlightToolbar,
    toolbarPosition,
    handleHighlightColorSelect,
    handleCloseHighlightToolbar,
  } = useReaderTextSelection({
    bookId,
    spread: pagination.spread,
    stageContentRef,
    chapterEntries,
    fontConfig: paginationConfig.fontConfig,
    getChapterBlocks,
    onHighlightCreate: (highlight) => {
      addHighlightMutation.mutate(highlight);
    },
  });

  const chapterIndexByHrefPath = useMemo(() => {
    const hrefMap = new Map<string, number>();
    for (const chapter of chapterEntries) {
      hrefMap.set(splitHrefFragment(chapter.href).path, chapter.index);
    }
    return hrefMap;
  }, [chapterEntries]);

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

  useEffect(() => {
    if (showHighlightToolbar) {
      clearActiveHighlight();
    }
  }, [clearActiveHighlight, showHighlightToolbar]);

  const canGoPrev = currentPage > 1;
  const canGoNext = !(
    pagination.status === "ready" &&
    totalPages > 0 &&
    currentPage >= totalPages
  );

  const onPrevChapter = useCallback(() => {
    if (currentChapterIndex > 0) {
      pagination.goToChapter(currentChapterIndex - 1, {
        intent: { kind: "jump", source: "chapter" },
      });
    }
  }, [currentChapterIndex, pagination]);

  const onNextChapter = useCallback(() => {
    if (currentChapterIndex < chapterEntries.length - 1) {
      pagination.goToChapter(currentChapterIndex + 1, {
        intent: { kind: "jump", source: "chapter" },
      });
    }
  }, [currentChapterIndex, chapterEntries.length, pagination]);

  const onScrubPreview = useCallback(
    (page: number) => {
      pagination.goToPage(page, {
        intent: { kind: "preview", source: "scrubber" },
      });
    },
    [pagination],
  );

  const onScrubCommit = useCallback(
    (page: number) => {
      pagination.goToPage(page, {
        intent: { kind: "jump", source: "scrubber" },
      });
    },
    [pagination],
  );

  const onGoToChapter = useCallback(
    (chapterIndex: number) => {
      pagination.goToChapter(chapterIndex, {
        intent: { kind: "jump", source: "chapter" },
      });
    },
    [pagination],
  );

  const onPageContentClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;

      const href = anchor.getAttribute("href")?.trim();
      if (!href) return;
      if (isExternalHref(href)) return;

      event.preventDefault();
      event.stopPropagation();

      const resolvedTarget = resolvePaginatedLinkTarget(
        href,
        chapterIndexByHrefPath,
      );
      if (!resolvedTarget) return;

      if (resolvedTarget.targetId) {
        pagination.goToTarget(
          resolvedTarget.chapterIndex,
          resolvedTarget.targetId,
          { intent: { kind: "jump", source: "internal-link" } },
        );
        return;
      }

      pagination.goToChapter(resolvedTarget.chapterIndex, {
        intent: { kind: "jump", source: "internal-link" },
      });
    },
    [chapterIndexByHrefPath, pagination],
  );

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
        <div className="relative h-[100dvh] overflow-hidden bg-gradient-to-b from-background via-background to-muted/20 font-sans text-foreground">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-secondary/45 to-transparent" />
            <div className="absolute inset-x-6 bottom-0 h-56 rounded-t-[3rem] bg-gradient-to-t from-muted/35 to-transparent" />
          </div>

          {/* Reading container — offset by safe-area insets so clientHeight is safe-area-adjusted */}
          <div
            ref={stageSlotRef}
            className="absolute inset-x-0 z-10"
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
              onPageContentClick={onPageContentClick}
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
            onBackToLibrary={() => navigate("/")}
            isBookmarked={isBookmarked}
            onToggleBookmark={() => setIsBookmarked((b) => !b)}
            onOpenMenu={() => setIsMenuOpen(true)}
          />

          <ReaderControlMenu
            isOpen={isMenuOpen}
            onClose={() => setIsMenuOpen(false)}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

          <ReaderSettingsSheet
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
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
            currentTitleChapterIndex={currentTitleChapterIndex}
            chapterEntries={chapterEntries}
            chapterStartPages={chapterStartPages}
            onScrubPreview={onScrubPreview}
            onScrubCommit={onScrubCommit}
            onGoToChapter={onGoToChapter}
            onPrevChapter={onPrevChapter}
            onNextChapter={onNextChapter}
            isLoading={pagination.status !== "ready"}
          />

          <HighlightToolbarContainer
            bookId={bookId}
            spineItemId={activeHighlightData?.spineItemId ?? undefined}
            highlights={bookHighlights}
            isCreatingHighlight={showHighlightToolbar}
            creationPosition={toolbarPosition}
            onCreateColorSelect={handleHighlightColorSelect}
            onCreateClose={handleCloseHighlightToolbar}
            activeHighlight={showHighlightToolbar ? null : activeHighlight}
            onEditClose={clearActiveHighlight}
            isNavVisible={chromeVisible}
            onCreateNoteSubmit={undefined}
          />
        </div>
      )}
    </ReaderController>
  );
}
