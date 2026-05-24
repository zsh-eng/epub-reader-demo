import { HighlightToolbarContainer } from "@/components/ReaderShared/HighlightToolbarContainer";
import { useInputBehavior } from "@/hooks/use-input-behavior";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { useCallback, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ReaderController } from "./ReaderController";
import { ReaderHeader } from "./ReaderHeader";
import { ReaderSheetHost } from "./ReaderSheetHost";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { SpreadStage } from "./SpreadStage";
import { ReaderFooter } from "./footer";
import { usePaginatedReaderLayout } from "./hooks/use-paginated-reader-layout";
import { useReaderAnnotations } from "./hooks/use-reader-annotations";
import { useReaderChromeState } from "./hooks/use-reader-chrome-state";
import { useReaderHandoffPrompt } from "./hooks/use-reader-handoff-prompt";
import { useReaderSession } from "./hooks/use-reader-session";
import {
  buildReaderPageDebugDump,
  collectReaderPageDebugDumpEnvironment,
  serializeReaderPageDebugDump,
} from "./debug/page-debug-dump";
import { DeferredEpubImageProvider } from "./shared/DeferredEpubImageProvider";

export function Reader() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const { state: chromeState, actions: chromeActions } = useReaderChromeState();
  const { chromeInteractionMode } = useInputBehavior();

  const stageSlotRef = useRef<HTMLDivElement>(null);
  const [stageSlotElement, setStageSlotElement] =
    useState<HTMLDivElement | null>(null);
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
  const { prompt: handoffPrompt } = useReaderHandoffPrompt({
    bookId,
    chapterStartPages: sessionState.navigation.chapterStartPages,
    totalPages: sessionState.navigation.totalPages,
    onJumpToPage: sessionActions.jumpToHandoffPage,
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
    publisherBookStylingEnabled:
      sessionState.pagination.paginationConfig.publisherBookStylingEnabled ??
      false,
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

  if (sessionState.status === "file-error") {
    return (
      <ReaderStateScreen
        title="Book file unavailable"
        message="The book metadata is synced, but the EPUB file is not available on this device yet."
        titleTone="destructive"
        action={{ label: "Back to Library", onClick: () => navigate("/") }}
      />
    );
  }

  const book = sessionState.book;
  const currentChapterEntry =
    sessionState.chapters.entries[
      sessionState.navigation.displayChapterIndex ??
        sessionState.navigation.currentChapterIndex
    ] ??
    sessionState.chapters.entries[sessionState.navigation.currentChapterIndex];
  const handleCopyDebugDump = async () => {
    const spread = sessionState.pagination.spread;

    if (!spread) {
      toast({
        title: "Dump unavailable",
        description: "Wait for pagination to render a page, then try again.",
        variant: "destructive",
      });
      return;
    }

    const dump = buildReaderPageDebugDump({
      book,
      settings: sessionState.settings,
      spread,
      paginationConfig: sessionState.pagination.paginationConfig,
      spreadConfig: sessionState.pagination.spreadConfig,
      layout: {
        viewport: stageViewport,
        spreadColumns: resolvedSpreadColumns,
        columnGapPx,
        paddingTopPx: stagePadding.paddingTop,
        paddingBottomPx: stagePadding.paddingBottom,
        paddingLeftPx: stagePadding.paddingX,
        paddingRightPx: stagePadding.paddingX,
      },
      environment: collectReaderPageDebugDumpEnvironment({
        stageSlotElement: stageSlotRef.current,
        stageContentElement: stageContentRef.current,
      }),
      chapterEntries: sessionState.chapters.entries,
      getBlocks: sessionResources.chapterAccess.getBlocks,
    });

    try {
      await navigator.clipboard.writeText(
        serializeReaderPageDebugDump(dump),
      );

      toast({
        title: "Debug dump copied",
        description:
          "Paste it into the reader debug panel to reproduce this page.",
      });
    } catch {
      toast({
        title: "Could not copy dump",
        description: "Your browser blocked clipboard access for this page.",
        variant: "destructive",
      });
    }
  };

  return (
    <ReaderController
      onNextPage={sessionActions.nextSpread}
      onPrevPage={sessionActions.prevSpread}
      canGoPrev={sessionState.navigation.canGoPrev}
      canGoNext={sessionState.navigation.canGoNext}
      chromeInteractionMode={chromeInteractionMode}
      isChromeSuppressed={chromeState.activeReaderSheet !== null}
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
        chromeDismissLayerProps,
      }) => (
        <div className="relative h-dvh overflow-hidden font-sans text-foreground">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-40" />
            <div className="absolute inset-x-6 bottom-0 h-56 rounded-t-[3rem]" />
          </div>
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 bg-background"
            style={{ height: "env(safe-area-inset-bottom)" }}
            aria-hidden="true"
          />

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

          {chromeDismissLayerProps && (
            <div
              {...chromeDismissLayerProps}
              className="absolute inset-0 z-[16] bg-transparent"
            />
          )}

          {/* Floating header — reading padding is rail-based, not chrome-height-based. */}
          <ReaderHeader
            chromeVisible={chromeVisible}
            chromeSurfaceProps={chromeSurfaceProps}
            bookTitle={book.title}
            onBackToLibrary={() => navigate("/")}
            isBookmarked={chromeState.isBookmarked}
            onToggleBookmark={chromeActions.toggleBookmark}
            onOpenMenu={() => chromeActions.openReaderSheet("tools")}
          />

          <ReaderSheetHost
            activeSheet={chromeState.activeReaderSheet}
            onOpenSheet={chromeActions.openReaderSheet}
            onCloseSheet={chromeActions.closeReaderSheet}
            settings={sessionState.settings}
            onUpdateSettings={sessionActions.updateSettings}
            toc={book.toc}
            chapterEntries={sessionState.chapters.entries}
            chapterStartPages={sessionState.navigation.chapterStartPages}
            currentChapterHref={currentChapterEntry?.href ?? ""}
            onNavigateToHref={sessionActions.openInternalHref}
            onCopyDebugDump={() => void handleCopyDebugDump()}
          />

          {/* Floating footer — chapter nav, page indicator, scrubber */}
          <ReaderFooter
            chromeVisible={chromeVisible}
            chromeSurfaceProps={chromeSurfaceProps}
            isContentsOpen={chromeState.activeReaderSheet === "contents"}
            currentPage={sessionState.navigation.currentPage}
            totalPages={sessionState.navigation.totalPages}
            currentChapterIndex={sessionState.navigation.currentChapterIndex}
            currentChapterEndIndex={
              sessionState.pagination.spread?.chapterIndexEnd ??
              sessionState.navigation.currentChapterIndex
            }
            displayChapterIndex={sessionState.navigation.displayChapterIndex}
            chapterEntries={sessionState.chapters.entries}
            chapterStartPages={sessionState.navigation.chapterStartPages}
            onScrubPreview={sessionActions.previewPage}
            onScrubCommit={sessionActions.commitPage}
            onGoToChapter={sessionActions.goToChapter}
            onPrevChapter={sessionActions.goToPreviousChapter}
            onOpenContents={() => chromeActions.openReaderSheet("contents")}
            isLoading={sessionState.pagination.status !== "ready"}
            handoffPrompt={handoffPrompt}
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
