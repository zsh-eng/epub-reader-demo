import { HighlightToolbarContainer } from "@/components/Reader/HighlightToolbarContainer";
import { LoadingSpinner } from "@/components/Reader/LoadingSpinner";
import { MobileReaderNav } from "@/components/Reader/MobileReaderNav";
import { NavigationButtons } from "@/components/Reader/NavigationButtons";
import { ReaderSettingsBar } from "@/components/Reader/ReaderSettingsBar";
import { SideNavigation } from "@/components/Reader/SideNavigation";
import ReaderContent from "@/components/ReaderContent";
import { useBookLoader } from "@/hooks/use-book-loader";
import {
  getManifestItemHref,
  useChapterContent,
} from "@/hooks/use-chapter-content";
import { useChapterNavigation } from "@/hooks/use-chapter-navigation";
import { useEpubProcessor } from "@/hooks/use-epub-processor";
import { useHighlightDOMSync } from "@/hooks/use-highlight-dom-sync";
import {
  useAddHighlightMutation,
  useHighlightsQuery,
} from "@/hooks/use-highlights-query";
import { useKeyboardNavigation } from "@/hooks/use-keyboard-navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { useProgressPersistence } from "@/hooks/use-progress-persistence";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { useScrollTarget } from "@/hooks/use-scroll-target";
import { useScrollVisibility } from "@/hooks/use-scroll-visibility";
import { useTextSelection } from "@/hooks/use-text-selection";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import type { Highlight } from "@/types/highlight";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { TableOfContents } from "./TableOfContents";

/**
 * Active highlight state - combines id and position into a single piece of state
 * to prevent impossible states (id without position or vice versa)
 */
export interface ActiveHighlightState {
  id: string;
  position: { x: number; y: number };
}

/**
 * Reader Component
 *
 * Main component for displaying and interacting with EPUB books.
 * This component orchestrates all the reader functionality including:
 * - Book loading and progress restoration
 * - Chapter navigation
 * - Table of contents
 * - Text selection and highlighting
 * - Reading progress auto-save (via useProgressPersistence)
 * - Keyboard navigation
 */
export function Reader() {
  // Route params
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  // Refs
  const readerContentRef = useRef<HTMLDivElement>(null);

  // Mobile detection
  const isMobile = useIsMobile();

  // Local state
  const [isTOCOpen, setIsTOCOpen] = useState(false);
  const [activeHighlight, setActiveHighlight] =
    useState<ActiveHighlightState | null>(null);

  // Load book and initial progress
  const { book, initialProgress, isLoading } = useBookLoader(bookId);
  const bookTitle = book?.title;

  // Ensure EPUB is processed (fetch and extract bookFiles if needed)
  const {
    isProcessing: isProcessingEpub,
    isReady: isEpubReady,
    error: epubProcessError,
  } = useEpubProcessor(bookId, book?.fileHash);

  // Chapter index state - initialized from saved progress or defaults to 0
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);

  // Track if we've initialized from saved progress
  const hasInitializedRef = useRef(false);

  // Get current spine item ID
  const currentSpineItemId = book?.spine[currentChapterIndex]?.idref;

  // Reader settings
  const { settings, updateSettings } = useReaderSettings();

  // Chapter content
  const manifestItemHref = getManifestItemHref(book, currentChapterIndex);
  const { chapterContent, isLoading: isChapterLoading } = useChapterContent(
    bookId,
    manifestItemHref,
  );
  const contentReady = !!chapterContent;

  // Scroll target management - handles scrolling when content is ready
  const { setScrollTarget, isScrolling } = useScrollTarget({
    contentRef: readerContentRef,
    contentReady,
  });

  // Initialize chapter index and scroll target from saved progress
  useEffect(() => {
    if (!initialProgress || hasInitializedRef.current) return;

    hasInitializedRef.current = true;
    setCurrentChapterIndex(initialProgress.currentSpineIndex);

    if (initialProgress.scrollProgress <= 0) {
      return;
    }
    setScrollTarget({
      type: "percentage",
      value: initialProgress.scrollProgress,
    });
  }, [initialProgress, setScrollTarget]);

  // Progress persistence - auto-saves reading progress
  useProgressPersistence({
    bookId: bookId ?? "",
    chapterIndex: currentChapterIndex,
    contentRef: readerContentRef,
    contentReady,
    enabled: !isScrolling && !!bookId,
  });

  // Highlights - TanStack Query for data, mutations for CRUD
  const { data: highlights = [] } = useHighlightsQuery(
    bookId,
    currentSpineItemId,
  );
  const addHighlightMutation = useAddHighlightMutation(
    bookId,
    currentSpineItemId,
  );

  // Sync highlights to DOM - reactive side effect of data changes
  useHighlightDOMSync(readerContentRef, highlights, contentReady);

  // Text selection hook for creating new highlights
  const {
    showHighlightToolbar,
    toolbarPosition,
    handleHighlightColorSelect,
    handleCloseHighlightToolbar,
  } = useTextSelection(
    readerContentRef,
    bookId,
    currentSpineItemId,
    (highlight: Highlight) => {
      addHighlightMutation.mutate(highlight);
    },
  );

  // Chapter navigation
  const {
    goToPreviousChapter,
    goToNextChapter,
    goToChapterByHref,
    goToChapterWithFragment,
  } = useChapterNavigation(
    book,
    bookId,
    currentChapterIndex,
    setCurrentChapterIndex,
    setScrollTarget,
  );

  // Keyboard navigation
  useKeyboardNavigation(goToPreviousChapter, goToNextChapter, () =>
    navigate("/"),
  );

  // Scroll visibility for mobile nav
  const isVisible = useScrollVisibility();

  // Set document title to book title
  useEffect(() => {
    if (!bookTitle) return;
    document.title = bookTitle;
    return () => {
      document.title = "Reader";
    };
  }, [bookTitle]);

  // Early returns
  if (isLoading) return <LoadingSpinner />;
  if (!book || !bookId) return null;

  // Show loading while EPUB is being processed
  if (isProcessingEpub) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <LoadingSpinner />
          <p className="text-muted-foreground text-sm">
            Preparing book for reading...
          </p>
        </div>
      </div>
    );
  }

  // Show error if EPUB processing failed
  if (epubProcessError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <p className="text-destructive font-medium">Failed to load book</p>
          <p className="text-muted-foreground text-sm">
            {epubProcessError.message}
          </p>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Back to Library
          </button>
        </div>
      </div>
    );
  }

  // Wait for EPUB to be ready before showing chapter content
  if (!isEpubReady || isChapterLoading) return <LoadingSpinner />;

  // Derived state
  const currentChapterTitle = getChapterTitleFromSpine(
    book,
    currentChapterIndex,
  );
  const hasPreviousChapter = currentChapterIndex > 0;
  const hasNextChapter = currentChapterIndex < book.spine.length - 1;

  // Render
  return (
    <div className="flex flex-col min-h-screen">
      {/* Desktop Navigation */}
      {!isMobile && (
        <SideNavigation
          onBack={() => navigate("/")}
          onPrevious={goToPreviousChapter}
          onNext={goToNextChapter}
          hasPreviousChapter={hasPreviousChapter}
          hasNextChapter={hasNextChapter}
        />
      )}

      {/* Desktop Settings Bar */}
      {!isMobile && (
        <ReaderSettingsBar
          settings={settings}
          onUpdateSettings={updateSettings}
        />
      )}

      {/* Mobile Navigation (includes settings drawer) */}
      {isMobile && (
        <MobileReaderNav
          isVisible={isVisible}
          settings={settings}
          onUpdateSettings={updateSettings}
          onBack={() => navigate("/")}
          onPrevious={goToPreviousChapter}
          onNext={goToNextChapter}
          hasPreviousChapter={hasPreviousChapter}
          hasNextChapter={hasNextChapter}
          toc={book.toc}
          currentChapterHref={manifestItemHref || ""}
          onNavigateToChapter={goToChapterByHref}
        />
      )}
      {
        <TableOfContents
          toc={book.toc}
          isOpen={isTOCOpen}
          onOpenChange={setIsTOCOpen}
          onNavigate={goToChapterByHref}
        />
      }

      <ReaderContent
        content={chapterContent}
        chapterIndex={currentChapterIndex}
        title={currentChapterTitle}
        ref={readerContentRef}
        onHighlightClick={(highlightId, position) => {
          // If clicking the same highlight, close the popover (toggle behavior)
          if (activeHighlight?.id === highlightId) {
            setActiveHighlight(null);
          } else {
            // Open popover for the clicked highlight
            setActiveHighlight({ id: highlightId, position });
          }
        }}
        activeHighlightId={activeHighlight?.id ?? null}
        settings={settings}
        onInternalLinkClick={goToChapterWithFragment}
      />

      <HighlightToolbarContainer
        bookId={bookId}
        spineItemId={currentSpineItemId}
        highlights={highlights}
        isCreatingHighlight={showHighlightToolbar}
        creationPosition={toolbarPosition}
        onCreateColorSelect={handleHighlightColorSelect}
        onCreateClose={handleCloseHighlightToolbar}
        activeHighlight={activeHighlight}
        onEditClose={() => setActiveHighlight(null)}
        isNavVisible={isVisible}
      />

      {/* Desktop Navigation Buttons */}
      {!isMobile && (
        <NavigationButtons
          currentChapterIndex={currentChapterIndex}
          totalChapters={book.spine.length}
          hasPreviousChapter={hasPreviousChapter}
          hasNextChapter={hasNextChapter}
          onPrevious={goToPreviousChapter}
          onNext={goToNextChapter}
        />
      )}
    </div>
  );
}
