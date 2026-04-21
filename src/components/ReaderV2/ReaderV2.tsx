import { HighlightToolbarContainer } from "@/components/Reader/HighlightToolbarContainer";
import { useInputBehavior } from "@/hooks/use-input-behavior";
import { useIsMobile } from "@/hooks/use-mobile";
import {
    useCallback,
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
import { usePaginatedReaderLayout } from "./hooks/use-paginated-reader-layout";
import { useReaderAnnotations } from "./hooks/use-reader-annotations";
import { useReaderSession } from "./hooks/use-reader-session";
import { DeferredEpubImageProvider } from "./shared/DeferredEpubImageProvider";

const COLUMN_GAP_PX = 20;

export function ReaderV2() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { chromeInteractionMode } = useInputBehavior();
  const [spreadColumns, setSpreadColumns] = useState<1 | 2>(1);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const stageSlotRef = useRef<HTMLDivElement>(null);
  const [stageSlotElement, setStageSlotElement] = useState<HTMLDivElement | null>(
    null,
  );
  const stageContentRef = useRef<HTMLDivElement>(null);
  const isChromePinned = isMenuOpen || isSettingsOpen;

  const handleStageSlotRef = useCallback((node: HTMLDivElement | null) => {
    stageSlotRef.current = node;
    setStageSlotElement(node);
  }, []);

  const {
    stageViewport,
    stagePadding,
    effectiveSpreadColumns,
    showColumnSelector,
  } = usePaginatedReaderLayout({
    stageSlotElement,
    isMobile,
    spreadColumns,
    onSpreadColumnsChange: setSpreadColumns,
  });

  const {
    resources: sessionResources,
    state: sessionState,
    actions: sessionActions,
  } = useReaderSession({
    bookId,
    viewport: stageViewport,
    spreadColumns: effectiveSpreadColumns,
  });

  const {
    state: annotationState,
    activeHighlight,
    activeHighlightData,
    isCreatingHighlight,
    creationPosition,
    selectColor,
    closeCreation,
    clearActiveHighlight,
  } = useReaderAnnotations({
    bookId,
    spread: sessionState.pagination.spread,
    stageContentRef,
    chapterEntries: sessionState.chapters.entries,
    fontConfig: sessionState.pagination.paginationConfig.fontConfig,
    chapterAccess: sessionResources.chapterAccess,
    highlights: sessionState.highlights,
    onCreateHighlight: sessionActions.createHighlight,
  });

  const onPageContentClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;

      const href = anchor.getAttribute("href")?.trim();
      if (!href) return;

      const handled = sessionActions.openInternalHref(href);
      if (!handled) return;

      event.preventDefault();
      event.stopPropagation();
    },
    [sessionActions],
  );

  if (sessionState.status === "loading") {
    return <ReaderStateScreen showSpinner title="Loading book" />;
  }

  if (sessionState.status === "not-found" || !bookId || !sessionState.book) {
    return (
      <ReaderStateScreen
        title="Book not found"
        action={{ label: "Back to Library", onClick: () => navigate("/") }}
      />
    );
  }

  const book = sessionState.book;

  return (
    <ReaderController
      onNextPage={sessionActions.nextSpread}
      onPrevPage={sessionActions.prevSpread}
      canGoPrev={sessionState.navigation.canGoPrev}
      canGoNext={sessionState.navigation.canGoNext}
      chromeInteractionMode={chromeInteractionMode}
      isChromePinned={isChromePinned}
      containerRef={stageSlotRef}
      topRailHeight={stagePadding.paddingTop}
      bottomRailHeight={stagePadding.paddingBottom}
    >
      {({
        chromeVisible,
        showHoverRails,
        topRailProps,
        bottomRailProps,
        chromeSurfaceProps,
      }) => (
        <div className="relative h-[100dvh] overflow-hidden bg-gradient-to-b from-background via-background to-muted/20 font-sans text-foreground">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-secondary/45 to-transparent" />
            <div className="absolute inset-x-6 bottom-0 h-56 rounded-t-[3rem] bg-gradient-to-t from-muted/35 to-transparent" />
          </div>

          {showHoverRails && (
            <>
              {/* Hover rails live in the existing top/bottom non-reading bands. */}
              <div
                {...topRailProps}
                className="absolute inset-x-0 z-[15]"
                style={{
                  ...topRailProps.style,
                  top: "env(safe-area-inset-top)",
                }}
              />
              <div
                {...bottomRailProps}
                className="absolute inset-x-0 z-[15]"
                style={{
                  ...bottomRailProps.style,
                  bottom: "max(env(safe-area-inset-bottom), 0.625rem)",
                }}
              />
            </>
          )}

          {/* Reading container — offset by safe-area insets so clientHeight is safe-area-adjusted */}
          <div
            ref={handleStageSlotRef}
            className="absolute inset-x-0 z-10"
            style={{
              top: "env(safe-area-inset-top)",
              bottom: "max(env(safe-area-inset-bottom), 0.625rem)",
            }}
          >
            <DeferredEpubImageProvider key={bookId} bookId={bookId}>
              <SpreadStage
                spread={sessionState.pagination.spread}
                spreadConfig={sessionState.pagination.spreadConfig}
                columnSpacingPx={COLUMN_GAP_PX}
                paginationConfig={sessionState.pagination.paginationConfig}
                stageContentRef={stageContentRef}
                onPageContentClick={onPageContentClick}
                paddingTopPx={stagePadding.paddingTop}
                paddingBottomPx={stagePadding.paddingBottom}
                paddingLeftPx={stagePadding.paddingX}
                paddingRightPx={stagePadding.paddingX}
              />
            </DeferredEpubImageProvider>
          </div>

          {/* Floating header — paddingTop handles safe-area notch, content is h-14 = 56px */}
          <ReaderV2Header
            chromeVisible={chromeVisible}
            chromeSurfaceProps={chromeSurfaceProps}
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
            settings={sessionState.settings}
            onUpdateSettings={sessionActions.updateSettings}
            showColumnSelector={showColumnSelector}
            spreadColumns={spreadColumns}
            onSpreadColumnsChange={setSpreadColumns}
          />

          {/* Floating footer — chapter nav, page indicator, scrubber */}
          <ReaderV2Footer
            chromeVisible={chromeVisible}
            chromeSurfaceProps={chromeSurfaceProps}
            currentPage={sessionState.navigation.currentPage}
            totalPages={sessionState.navigation.totalPages}
            currentChapterIndex={sessionState.navigation.currentChapterIndex}
            currentTitleChapterIndex={sessionState.navigation.currentTitleChapterIndex}
            chapterEntries={sessionState.chapters.entries}
            chapterStartPages={sessionState.navigation.chapterStartPages}
            onScrubPreview={sessionActions.previewPage}
            onScrubCommit={sessionActions.commitPage}
            onGoToChapter={sessionActions.goToChapter}
            onPrevChapter={sessionActions.goToPreviousChapter}
            onNextChapter={sessionActions.goToNextChapter}
            isLoading={sessionState.pagination.status !== "ready"}
          />

          <HighlightToolbarContainer
            bookId={bookId}
            spineItemId={activeHighlightData?.spineItemId ?? undefined}
            highlights={sessionState.highlights}
            isCreatingHighlight={isCreatingHighlight}
            creationPosition={creationPosition}
            onCreateColorSelect={selectColor}
            onCreateClose={closeCreation}
            activeHighlight={
              annotationState.kind === "active" ? activeHighlight : null
            }
            onEditClose={clearActiveHighlight}
            isNavVisible={chromeVisible}
            onCreateNoteSubmit={undefined}
          />
        </div>
      )}
    </ReaderController>
  );
}
