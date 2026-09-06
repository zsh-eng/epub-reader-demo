import type { Highlight } from "@/types/highlight";
import { HighlightToolbarContainer } from "@/features/reader/shared/HighlightToolbarContainer";
import { useInputBehavior } from "@/features/reader/hooks/use-input-behavior";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { recordReaderTraceSpan } from "@/lib/reader-performance-trace";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isInteractiveTapTarget } from "./hooks/use-touch-spread-tap-nav";
import { ReaderNotesPrototype } from "./ReaderNotesPrototype";
import { ReaderController } from "./ReaderController";
import { ReaderHeader } from "./ReaderHeader";
import { useSidebar } from "@/components/ui/sidebar";
import { ReaderSheetHost } from "./ReaderSheetHost";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { SpreadStage } from "./SpreadStage";
import { ReaderFooter } from "./footer";
import { usePaginatedReaderLayout } from "./hooks/use-paginated-reader-layout";
import { useReaderAnnotations } from "./hooks/use-reader-annotations";
import { useReaderChromeState } from "./hooks/use-reader-chrome-state";
import { useReaderDisplayReadiness } from "./hooks/use-reader-display-readiness";
import { useReaderHandoffPrompt } from "./hooks/use-reader-handoff-prompt";
import {
  useReaderPerformanceTraceLifecycle,
  useReaderPerformanceTraceRoute,
} from "./hooks/use-reader-performance-trace";
import { useReaderSession } from "./hooks/use-reader-session";
import { useReaderStatusPrompt } from "./hooks/use-reader-status-prompt";
import {
  buildReaderPageDebugDump,
  collectReaderPageDebugDumpEnvironment,
  serializeReaderPageDebugDump,
} from "./debug/page-debug-dump";
import { DeferredEpubImageProvider } from "./shared/DeferredEpubImageProvider";

function DisplayReadyCommitProbe({
  paginationStatus,
  readerStatus,
}: {
  paginationStatus: string;
  readerStatus: string;
}): null {
  const renderStartedAtMsRef = useRef(performance.now());
  const statusRef = useRef({ paginationStatus, readerStatus });

  useLayoutEffect(() => {
    const committedAtMs = performance.now();
    const initialStatus = statusRef.current;
    recordReaderTraceSpan({
      name: "display-ready-reader-render-commit",
      lane: "processing",
      startPerformanceMs: renderStartedAtMsRef.current,
      endPerformanceMs: committedAtMs,
      details: {
        durationMs:
          Math.round((committedAtMs - renderStartedAtMsRef.current) * 10) / 10,
        paginationStatus: initialStatus.paginationStatus,
        readerStatus: initialStatus.readerStatus,
      },
    });
  }, []);

  return null;
}

export function Reader() {
  const { open: isSidebarOpen, openMobile: isMobileSidebarOpen } = useSidebar();
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [annotating, setAnnotating] = useState(false);
  const [commentPosition, setCommentPosition] = useState({ top: 112, page: 1 });
  const [noteQuote, setNoteQuote] = useState<Highlight | null>(null);
  const [noteViewportHeight, setNoteViewportHeight] = useState<number | null>(
    null,
  );
  const handleNotesActive = useCallback((active: boolean) => {
    setNoteViewportHeight(active ? window.innerHeight : null);
  }, []);

  const closeNotes = useCallback(
    () => handleNotesActive(false),
    [handleNotesActive],
  );

  const { state: chromeState, actions: chromeActions } = useReaderChromeState();
  const { chromeInteractionMode } = useInputBehavior();
  useReaderPerformanceTraceRoute(bookId);

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
    isMeasured: isStageMeasured,
  } = usePaginatedReaderLayout({
    stageSlotElement,
    isMobile,
  });
  const isReaderStageMeasured =
    isStageMeasured && stageSlotElement?.dataset.readerStageSlot === "content";

  const {
    resources: sessionResources,
    state: sessionState,
    actions: sessionActions,
  } = useReaderSession({
    bookId,
    viewport: stageViewport,
    spreadColumns: resolvedSpreadColumns,
    layoutReady: isReaderStageMeasured,
  });
  const resumeBackgroundLoad = sessionActions.resumeBackgroundLoad;

  const {
    state: annotationState,
    activeHighlight,
    activeHighlightData,
    isCreatingHighlight,
    creationPosition,
    creationText,
    selectColor,
    closeCreation,
    clearActiveHighlight,
    captureSelectionNote,
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

  const { displayReady, settledPaintReady } = useReaderDisplayReadiness({
    bookId,
    contentReady: isReaderStageMeasured && sessionState.status === "ready",
    stageContentRef,
  });
  const { prompt: handoffPrompt } = useReaderHandoffPrompt({
    bookId,
    // The handoff target needs the complete chapter-to-page map. Starting this
    // optional storage query earlier only makes it compete with startup work.
    enabled: settledPaintReady && sessionState.pagination.status === "ready",
    chapterStartPages: sessionState.navigation.chapterStartPages,
    totalPages: sessionState.navigation.totalPages,
    onJumpToPage: sessionActions.jumpToHandoffPage,
  });
  useReaderPerformanceTraceLifecycle({
    bookId,
    book: sessionState.book,
    status: sessionState.status,
    paginationStatus: sessionState.pagination.status,
    displayReady,
    settledPaintReady,
    chapterCount: sessionState.chapters.entries.length,
    viewport: stageViewport,
    spreadColumns: resolvedSpreadColumns,
    settings: sessionState.settings,
  });
  useEffect(() => {
    if (!settledPaintReady) return;
    resumeBackgroundLoad();
  }, [resumeBackgroundLoad, settledPaintReady]);
  useReaderStatusPrompt({ bookId, isReady: displayReady });

  if (sessionState.status === "not-found" || !bookId) {
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

  if (!sessionState.book) {
    return (
      <div className="relative h-dvh overflow-hidden overscroll-none bg-background">
        <div
          ref={handleStageSlotRef}
          data-reader-stage-slot="measurement"
          aria-hidden="true"
          className="invisible absolute inset-x-0"
          style={{
            top: "env(safe-area-inset-top)",
            bottom: "max(env(safe-area-inset-bottom), 0.625rem)",
          }}
        />
      </div>
    );
  }

  const book = sessionState.book;
  const currentChapterEntry =
    sessionState.chapters.entries[
      sessionState.navigation.displayChapterIndex ??
        sessionState.navigation.currentChapterIndex
    ] ??
    sessionState.chapters.entries[sessionState.navigation.currentChapterIndex];
  const isReaderInteractionSuppressed =
    chromeState.activeReaderSheet !== null ||
    isSidebarOpen ||
    isMobileSidebarOpen ||
    !displayReady;
  const shouldPrepareSwipePages =
    chromeInteractionMode === "touch" && displayReady;
  const swipeNavigationEnabled =
    shouldPrepareSwipePages && !isReaderInteractionSuppressed;
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
      await navigator.clipboard.writeText(serializeReaderPageDebugDump(dump));

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
    <div className="relative h-dvh overflow-hidden overscroll-none bg-background">
      {displayReady && (
        <DisplayReadyCommitProbe
          key={bookId}
          paginationStatus={sessionState.pagination.status}
          readerStatus={sessionState.status}
        />
      )}
      <div className="h-full">
        <ReaderController
          onNextPage={sessionActions.nextSpread}
          onPrevPage={sessionActions.prevSpread}
          canGoPrev={sessionState.navigation.canGoPrev}
          canGoNext={sessionState.navigation.canGoNext}
          chromeInteractionMode={chromeInteractionMode}
          isChromeSuppressed={isReaderInteractionSuppressed}
          onDismissContentTap={
            noteViewportHeight === null ? undefined : closeNotes
          }
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
            hideChrome,
          }) => (
            <div
              className="relative h-dvh overflow-hidden font-sans text-foreground"
              style={
                noteViewportHeight === null
                  ? undefined
                  : { height: noteViewportHeight }
              }
            >
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 h-40" />
                <div className="absolute inset-x-6 bottom-0 h-56 rounded-t-[3rem]" />
              </div>
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 bg-background"
                style={{ height: "env(safe-area-inset-bottom)" }}
                aria-hidden="true"
              />

              {displayReady && showHoverRails && (
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
                onClickCapture={(event) => {
                  if (annotating) {
                    const target =
                      event.target instanceof Element ? event.target : null;
                    const fragment = target?.closest(
                      "[data-content-anchor-start]",
                    );
                    const page = target?.closest<HTMLElement>(
                      "[data-reader-current-page]",
                    );
                    if (!fragment || !page) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const range = document.createRange();
                    range.selectNodeContents(fragment);
                    const selection = window.getSelection();
                    selection?.removeAllRanges();
                    selection?.addRange(range);
                    const note = captureSelectionNote();
                    if (!note) return;
                    setNoteQuote(note);
                    setCommentPosition({
                      top: fragment.getBoundingClientRect().top,
                      page: Number(page.dataset.readerCurrentPage),
                    });
                    closeCreation();
                    setAnnotating(false);
                    handleNotesActive(true);
                    return;
                  }
                  if (
                    noteViewportHeight === null ||
                    event.defaultPrevented ||
                    isInteractiveTapTarget(event.target)
                  )
                    return;
                  if (
                    "pointerType" in event.nativeEvent &&
                    event.nativeEvent.pointerType === "touch"
                  )
                    return;
                  if (window.getSelection()?.toString()) return;
                  event.preventDefault();
                  closeNotes();
                }}
                ref={handleStageSlotRef}
                data-reader-stage-slot="content"
                className={`absolute inset-x-0 z-10 ${annotating ? "cursor-crosshair [&_*]:!cursor-crosshair" : ""}`}
                style={{
                  top: "env(safe-area-inset-top)",
                  bottom: "max(env(safe-area-inset-bottom), 0.625rem)",
                }}
              >
                <DeferredEpubImageProvider key={bookId} bookId={bookId}>
                  <SpreadStage
                    spread={sessionState.pagination.spread}
                    previousSpread={
                      sessionState.pagination.spreadWindow?.previous
                    }
                    nextSpread={sessionState.pagination.spreadWindow?.next}
                    spreadConfig={sessionState.pagination.spreadConfig}
                    columnSpacingPx={columnGapPx}
                    paginationConfig={sessionState.pagination.paginationConfig}
                    stageContentRef={stageContentRef}
                    onLinkActivate={sessionActions.openInternalHref}
                    renderAdjacentSpreads={shouldPrepareSwipePages}
                    swipeEnabled={swipeNavigationEnabled}
                    onSwipeStart={hideChrome}
                    onSwipeNext={sessionActions.nextSpread}
                    onSwipePrevious={sessionActions.prevSpread}
                    paddingTopPx={stagePadding.paddingTop}
                    paddingBottomPx={stagePadding.paddingBottom}
                    paddingLeftPx={stagePadding.paddingX}
                    paddingRightPx={stagePadding.paddingX}
                  />
                </DeferredEpubImageProvider>
              </div>

              <ReaderHeader
                chromeVisible={
                  noteViewportHeight === null &&
                  (!displayReady || chromeVisible)
                }
                chromeSurfaceProps={chromeSurfaceProps}
                bookTitle={book.title}
                showBackButton={isMobile}
                onBackToLibrary={() => navigate("/")}
                isBookmarked={chromeState.isBookmarked}
                onToggleBookmark={chromeActions.toggleBookmark}
                onOpenMenu={() => {
                  if (displayReady) chromeActions.openReaderSheet("tools");
                }}
              />

              {/* Keep both chrome edges visible while pagination prepares. */}
              <ReaderFooter
                chromeVisible={
                  noteViewportHeight === null &&
                  (!displayReady || chromeVisible)
                }
                chromeSurfaceProps={chromeSurfaceProps}
                isContentsOpen={chromeState.activeReaderSheet === "contents"}
                currentPage={sessionState.navigation.currentPage}
                totalPages={sessionState.navigation.totalPages}
                currentChapterIndex={
                  sessionState.navigation.currentChapterIndex
                }
                currentChapterEndIndex={
                  sessionState.pagination.spread?.chapterIndexEnd ??
                  sessionState.navigation.currentChapterIndex
                }
                displayChapterIndex={
                  sessionState.navigation.displayChapterIndex
                }
                chapterEntries={sessionState.chapters.entries}
                chapterStartPages={sessionState.navigation.chapterStartPages}
                onScrubPreview={sessionActions.previewPage}
                onScrubCommit={sessionActions.commitPage}
                onGoToChapter={sessionActions.goToChapter}
                onPrevChapter={sessionActions.goToPreviousChapter}
                onOpenContents={() => {
                  if (displayReady) chromeActions.openReaderSheet("contents");
                }}
                isLoading={
                  !displayReady || sessionState.pagination.status !== "ready"
                }
                onOpenNote={
                  isMobile ? () => handleNotesActive(true) : undefined
                }
                handoffPrompt={handoffPrompt}
              />

              {displayReady && (
                <>
                  <ReaderNotesPrototype
                    key={bookId}
                    open={noteViewportHeight !== null}
                    location={{
                      page: sessionState.navigation.currentPage,
                      chapter: currentChapterEntry?.title ?? "Current chapter",
                    }}
                    desktop={!isMobile}
                    annotating={annotating}
                    onAnnotatingChange={setAnnotating}
                    commentPosition={commentPosition}
                    quote={noteQuote}
                    onClearQuote={() => setNoteQuote(null)}
                    onActiveChange={handleNotesActive}
                    margin={{
                      width: stagePadding.paddingX,
                      enabled: !isMobile && !isReaderInteractionSuppressed,
                      location: {
                        page: Math.min(
                          sessionState.navigation.totalPages,
                          sessionState.navigation.currentPage +
                            resolvedSpreadColumns -
                            1,
                        ),
                        chapter:
                          sessionState.chapters.entries[
                            sessionState.pagination.spread?.chapterIndexEnd ??
                              sessionState.navigation.currentChapterIndex
                          ]?.title ?? "Current chapter",
                      },
                    }}
                    onVisit={sessionActions.commitPage}
                  />
                  <ReaderSheetHost
                    isMobile={isMobile}
                    activeSheet={chromeState.activeReaderSheet}
                    onOpenSheet={chromeActions.openReaderSheet}
                    onCloseSheet={chromeActions.closeReaderSheet}
                    book={book}
                    settings={sessionState.settings}
                    onUpdateSettings={sessionActions.updateSettings}
                    toc={book.toc}
                    chapterEntries={sessionState.chapters.entries}
                    chapterStartPages={
                      sessionState.navigation.chapterStartPages
                    }
                    currentChapterHref={currentChapterEntry?.href ?? ""}
                    onNavigateToHref={sessionActions.openInternalHref}
                    onOpenNotes={() => {
                      chromeActions.closeReaderSheet();
                      setAnnotating(true);
                    }}
                    onCopyDebugDump={() => void handleCopyDebugDump()}
                  />

                  <HighlightToolbarContainer
                    bookId={bookId}
                    spineItemId={activeHighlightData?.spineItemId ?? undefined}
                    highlights={sessionState.highlights}
                    isCreatingHighlight={isCreatingHighlight}
                    creationPosition={creationPosition}
                    creationText={creationText}
                    onCreateColorSelect={selectColor}
                    onCreateClose={closeCreation}
                    activeHighlight={
                      annotationState.kind === "active" ? activeHighlight : null
                    }
                    onEditClose={clearActiveHighlight}
                    isNavVisible={chromeVisible}
                    onCreateNoteSubmit={undefined}
                    onAddSelectionNote={() => {
                      const note = captureSelectionNote();
                      if (!note) return;
                      setNoteQuote(note);
                      setCommentPosition({
                        top: creationPosition.y,
                        page: sessionState.navigation.currentPage,
                      });
                      closeCreation();
                      handleNotesActive(true);
                    }}
                    onAddHighlightNote={(highlight) => {
                      setCommentPosition({
                        top: activeHighlight?.position.y ?? 112,
                        page: sessionState.navigation.currentPage,
                      });
                      setNoteQuote({ ...highlight });
                      clearActiveHighlight();
                      handleNotesActive(true);
                    }}
                  />
                </>
              )}
            </div>
          )}
        </ReaderController>
      </div>
    </div>
  );
}
