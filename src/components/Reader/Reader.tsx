import { HighlightToolbarContainer } from "@/components/ReaderShared/HighlightToolbarContainer";
import { useInputBehavior } from "@/hooks/use-input-behavior";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCallback, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ReaderController } from "./ReaderController";
import { ReaderHeader } from "./ReaderHeader";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { ReaderToolsSheet } from "./ReaderToolsSheet";
import { SpreadStage } from "./SpreadStage";
import { ReaderFooter } from "./footer";
import { usePaginatedReaderLayout } from "./hooks/use-paginated-reader-layout";
import { useReaderAnnotations } from "./hooks/use-reader-annotations";
import { useReaderChromeState } from "./hooks/use-reader-chrome-state";
import { useReaderSession } from "./hooks/use-reader-session";
import { DeferredEpubImageProvider } from "./shared/DeferredEpubImageProvider";

export function Reader() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const { state: chromeState, actions: chromeActions } = useReaderChromeState();
  const { chromeInteractionMode } = useInputBehavior();

  const stageSlotRef = useRef<HTMLDivElement>(null);
  const [stageSlotElement, setStageSlotElement] = useState<HTMLDivElement | null>(
    null,
  );
  const stageContentRef = useRef<HTMLDivElement>(null);

  const handleStageSlotRef = useCallback((node: HTMLDivElement | null) => {
    stageSlotRef.current = node;
    setStageSlotElement(node);
  }, []);

  const {
    resolvedSpreadColumns,
    stageViewport,
    stagePadding,
    topRailHeight,
    bottomRailHeight,
    columnGapPx,
  } = usePaginatedReaderLayout({
    stageSlotElement,
    isMobile,
  });

  const {
    resources: sessionResources,
    state: sessionState,
    actions: sessionActions,
  } = useReaderSession({
    bookId,
    viewport: stageViewport,
    spreadColumns: resolvedSpreadColumns,
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
      isChromePinned={chromeState.isChromePinned}
      containerRef={stageSlotRef}
      topRailHeight={topRailHeight}
      bottomRailHeight={bottomRailHeight}
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
                columnSpacingPx={columnGapPx}
                paginationConfig={sessionState.pagination.paginationConfig}
                stageContentRef={stageContentRef}
                onLinkActivate={sessionActions.openInternalHref}
                paddingTopPx={stagePadding.paddingTop}
                paddingBottomPx={stagePadding.paddingBottom}
                paddingLeftPx={stagePadding.paddingX}
                paddingRightPx={stagePadding.paddingX}
              />
            </DeferredEpubImageProvider>
          </div>

          {/* Floating header — reading padding is rail-based, not chrome-height-based. */}
          <ReaderHeader
            chromeVisible={chromeVisible}
            chromeSurfaceProps={chromeSurfaceProps}
            bookTitle={book.title}
            onBackToLibrary={() => navigate("/")}
            isBookmarked={chromeState.isBookmarked}
            onToggleBookmark={chromeActions.toggleBookmark}
            onOpenMenu={chromeActions.openTools}
          />

          <ReaderToolsSheet
            isOpen={chromeState.isToolsOpen}
            onClose={chromeActions.closeTools}
            settings={sessionState.settings}
            onUpdateSettings={sessionActions.updateSettings}
          />

          {/* Floating footer — chapter nav, page indicator, scrubber */}
          <ReaderFooter
            chromeVisible={chromeVisible}
            chromeSurfaceProps={chromeSurfaceProps}
            currentPage={sessionState.navigation.currentPage}
            totalPages={sessionState.navigation.totalPages}
            currentChapterIndex={sessionState.navigation.currentChapterIndex}
            currentChapterEndIndex={
              sessionState.pagination.spread?.chapterIndexEnd ??
              sessionState.navigation.currentChapterIndex
            }
            currentTitleChapterIndex={sessionState.navigation.currentTitleChapterIndex}
            chapterEntries={sessionState.chapters.entries}
            chapterStartPages={sessionState.navigation.chapterStartPages}
            onScrubPreview={sessionActions.previewPage}
            onScrubCommit={sessionActions.commitPage}
            onGoToChapter={sessionActions.goToChapter}
            onPrevChapter={sessionActions.goToPreviousChapter}
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
