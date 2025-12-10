import { HighlightToolbar } from "@/components/HighlightToolbar";
import { LoadingSpinner } from "@/components/Reader/LoadingSpinner";
import { NavigationButtons } from "@/components/Reader/NavigationButtons";
import { ReaderSettingsBar } from "@/components/Reader/ReaderSettingsBar";
import { TableOfContents } from "@/components/Reader/TableOfContents";
import ReaderContent from "@/components/ReaderContent";
import { ScrollRestoration } from "@/components/ScrollRestoration";
import { Button } from "@/components/ui/button";
import { useBookLoader } from "@/hooks/use-book-loader";
import { useChapterContent } from "@/hooks/use-chapter-content";
import { useChapterNavigation } from "@/hooks/use-chapter-navigation";
import { useHighlights } from "@/hooks/use-highlights";
import { useKeyboardNavigation } from "@/hooks/use-keyboard-navigation";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { useTextSelection } from "@/hooks/use-text-selection";
import { type HighlightColor } from "@/lib/highlight-constants";
import {
  applyHighlightToLiveDOM,
  removeHighlightFromLiveDOM,
} from "@/lib/highlight-utils";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import type { Highlight } from "@/types/highlight";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

/**
 * Reader Component
 *
 * Main component for displaying and interacting with EPUB books.
 * This component orchestrates all the reader functionality including:
 * - Book loading and progress restoration
 * - Chapter navigation
 * - Table of contents
 * - Text selection and highlighting
 * - Reading progress auto-save (via ScrollRestoration)
 * - Keyboard navigation
 */
export function Reader() {
  // Route params
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  // Refs
  const contentRef = useRef<HTMLDivElement>(null);

  // Local state (minimal)
  const [isTOCOpen, setIsTOCOpen] = useState(false);

  // Highlight delete popover state
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(
    null,
  );
  const [deletePopoverPosition, setDeletePopoverPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Load book and initial progress
  const { book, initialProgress, isLoading } = useBookLoader(bookId);

  // Chapter index state - initialized from saved progress or defaults to 0
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);

  // Initialize chapter index from saved progress when it loads
  useEffect(() => {
    if (initialProgress) {
      setCurrentChapterIndex(initialProgress.currentSpineIndex);
    }
  }, [initialProgress]);

  // Get current spine item ID
  const currentSpineItemId = book?.spine[currentChapterIndex]?.idref;

  const { highlights, addHighlight, deleteHighlight, updateHighlight } =
    useHighlights(bookId, currentSpineItemId);

  const { settings, updateSettings } = useReaderSettings();

  const { chapterContent } = useChapterContent(
    book,
    bookId,
    currentChapterIndex,
  );

  // Sync highlights to the live DOM whenever content or highlights change.
  // This is the single source of truth for highlight DOM state - all highlight
  // appearance updates (new highlights, color changes, etc.) flow through here.
  useEffect(() => {
    if (!contentRef.current || !book || !chapterContent) return;

    const currentSpineItemId = book.spine[currentChapterIndex]?.idref;
    if (!currentSpineItemId) return;

    const chapterHighlights = highlights.filter(
      (h) => h.spineItemId === currentSpineItemId,
    );

    chapterHighlights.forEach((highlight) => {
      const existingMark = contentRef.current?.querySelector(
        `mark[data-highlight-id="${highlight.id}"]`,
      );
      if (!existingMark) {
        // New highlight - apply it to the DOM
        applyHighlightToLiveDOM(contentRef.current!, highlight);
        return;
      }

      if (!(existingMark instanceof HTMLElement)) {
        return;
      }

      if (existingMark.dataset.color === highlight.color) {
        return;
      }

      // Existing highlight - sync the color in case it changed
      const allMarkElementsForId = contentRef.current!.querySelectorAll(
        `mark[data-highlight-id="${highlight.id}"]`,
      );
      allMarkElementsForId.forEach((mark) => {
        if (mark instanceof HTMLElement) {
          mark.dataset.color = highlight.color;
        }
      });
    });
  }, [chapterContent, highlights, book, currentChapterIndex]);

  const handleHighlightCreate = useCallback(
    (highlight: Highlight) => {
      addHighlight(highlight);
      if (contentRef.current) {
        applyHighlightToLiveDOM(contentRef.current, highlight);
      }
    },
    [addHighlight],
  );

  const handleHighlightDelete = useCallback(
    (highlightId: string) => {
      deleteHighlight(highlightId);
      if (contentRef.current) {
        removeHighlightFromLiveDOM(contentRef.current, highlightId);
      }

      setActiveHighlightId(null);
      setDeletePopoverPosition(null);
    },
    [deleteHighlight],
  );

  const handleHighlightUpdate = useCallback(
    (highlightId: string, newColorName: HighlightColor) => {
      updateHighlight(highlightId, { color: newColorName });
    },
    [updateHighlight],
  );

  const handleHighlightClick = useCallback(
    (highlightId: string, position: { x: number; y: number }) => {
      // If clicking the same highlight, close the popover
      if (activeHighlightId === highlightId) {
        setActiveHighlightId(null);
        setDeletePopoverPosition(null);
      } else {
        // Open popover for the clicked highlight
        setActiveHighlightId(highlightId);
        setDeletePopoverPosition(position);
      }
    },
    [activeHighlightId],
  );

  // Close delete popover
  const handleCloseDeletePopover = useCallback(() => {
    setActiveHighlightId(null);
    setDeletePopoverPosition(null);
  }, []);

  const {
    showHighlightToolbar,
    toolbarPosition,
    handleHighlightColorSelect,
    handleCloseHighlightToolbar,
  } = useTextSelection(
    contentRef,
    bookId,
    currentSpineItemId,
    handleHighlightCreate,
  );

  const { goToPreviousChapter, goToNextChapter, goToChapterByHref } =
    useChapterNavigation(
      book,
      bookId,
      currentChapterIndex,
      setCurrentChapterIndex,
    );

  useKeyboardNavigation(goToPreviousChapter, goToNextChapter);

  // Early returns
  if (isLoading) return <LoadingSpinner />;
  if (!book || !bookId) return null;

  // Derived state
  const activeHighlight = highlights.find((h) => h.id === activeHighlightId);
  const currentChapterTitle = getChapterTitleFromSpine(
    book,
    currentChapterIndex,
  );
  const hasPreviousChapter = currentChapterIndex > 0;
  const hasNextChapter = currentChapterIndex < book.spine.length - 1;

  // Render
  return (
    <div className="flex flex-col min-h-screen">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate("/")}
        aria-label="Back to library"
        className="top-6 left-4 sticky"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <TableOfContents
        toc={book.toc}
        isOpen={isTOCOpen}
        onOpenChange={setIsTOCOpen}
        onNavigate={goToChapterByHref}
      />

      <ScrollRestoration
        bookId={bookId}
        chapterIndex={currentChapterIndex}
        contentRef={contentRef}
        initialProgress={initialProgress}
        contentReady={!!chapterContent}
      >
        {({ isRestoring }) => (
          <div
            className="transition-opacity duration-150"
            style={{ opacity: isRestoring ? 0 : 1 }}
          >
            <ReaderContent
              content={chapterContent}
              chapterIndex={currentChapterIndex}
              title={currentChapterTitle}
              ref={contentRef}
              onHighlightClick={handleHighlightClick}
              activeHighlightId={activeHighlightId}
              settings={settings}
            />
          </div>
        )}
      </ScrollRestoration>

      <ReaderSettingsBar
        settings={settings}
        onUpdateSettings={updateSettings}
      />

      {showHighlightToolbar && (
        <HighlightToolbar
          position={toolbarPosition}
          onColorSelect={handleHighlightColorSelect}
          onClose={handleCloseHighlightToolbar}
        />
      )}

      {deletePopoverPosition && activeHighlight && (
        <HighlightToolbar
          position={deletePopoverPosition}
          currentColor={activeHighlight.color}
          onColorSelect={(color) =>
            handleHighlightUpdate(activeHighlight.id, color)
          }
          onDelete={() => handleHighlightDelete(activeHighlight.id)}
          onClose={handleCloseDeletePopover}
        />
      )}

      <NavigationButtons
        currentChapterIndex={currentChapterIndex}
        totalChapters={book.spine.length}
        hasPreviousChapter={hasPreviousChapter}
        hasNextChapter={hasNextChapter}
        onPrevious={goToPreviousChapter}
        onNext={goToNextChapter}
      />
    </div>
  );
}
