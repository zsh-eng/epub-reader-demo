import { HighlightDeletePopover } from '@/components/HighlightDeletePopover';
import { HighlightToolbar } from '@/components/HighlightToolbar';
import { LoadingSpinner } from '@/components/Reader/LoadingSpinner';
import { NavigationButtons } from '@/components/Reader/NavigationButtons';
import { ReaderHeader } from '@/components/Reader/ReaderHeader';
import { TableOfContents } from '@/components/Reader/TableOfContents';
import ReaderContent from '@/components/ReaderContent';
import { useBookLoader } from '@/hooks/use-book-loader';
import { useChapterContent } from '@/hooks/use-chapter-content';
import { useChapterNavigation } from '@/hooks/use-chapter-navigation';
import { useKeyboardNavigation } from '@/hooks/use-keyboard-navigation';
import { useReadingProgress } from '@/hooks/use-reading-progress';
import { useTextSelection } from '@/hooks/use-text-selection';
import {
    HIGHLIGHT_COLORS,
    type HighlightColor,
} from '@/lib/highlight-constants';
import {
    applyHighlightToLiveDOM,
    removeHighlightFromLiveDOM,
} from '@/lib/highlight-utils';
import { getChapterTitleFromSpine } from '@/lib/toc-utils';
import type { Highlight } from '@/types/highlight';
import { useCallback, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

/**
 * Reader Component
 *
 * Main component for displaying and interacting with EPUB books.
 * This component orchestrates all the reader functionality including:
 * - Book loading and progress restoration
 * - Chapter navigation
 * - Table of contents
 * - Text selection and highlighting
 * - Reading progress auto-save
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

  // In-memory highlights state
  // This maintains the current highlights for this reading session
  // In the future, this will sync with the database
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  // Highlight delete popover state
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(
    null
  );
  const [deletePopoverPosition, setDeletePopoverPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Custom hooks - all complex logic extracted
  const {
    book,
    currentChapterIndex,
    setCurrentChapterIndex,
    isLoading,
    lastScrollProgress,
  } = useBookLoader(bookId);

  // For now, initial highlights is just an empty array
  // In the future, this would be loaded from the database
  const initialHighlights: Highlight[] = [];

  const { chapterContent } = useChapterContent(
    book,
    bookId,
    currentChapterIndex,
    initialHighlights
  );

  const handleHighlightCreate = useCallback((highlight: Highlight) => {
    setHighlights((prev) => [...prev, highlight]);
    if (contentRef.current) {
      applyHighlightToLiveDOM(contentRef.current, highlight);
    }
  }, []);

  const handleHighlightDelete = useCallback((highlightId: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
    if (contentRef.current) {
      removeHighlightFromLiveDOM(contentRef.current, highlightId);
    }

    setActiveHighlightId(null);
    setDeletePopoverPosition(null);
  }, []);

  const handleHighlightUpdate = useCallback(
    (highlightId: string, newColorName: HighlightColor) => {
      const newColor = HIGHLIGHT_COLORS.find((c) => c.name === newColorName);
      if (!newColor) return;

      setHighlights((prev) =>
        prev.map((h) => {
          if (h.id === highlightId) {
            return { ...h, color: newColorName };
          }
          return h;
        })
      );

      if (contentRef.current) {
        const marks = contentRef.current.querySelectorAll(
          `mark[data-highlight-id="${highlightId}"]`
        );
        marks.forEach((mark) => {
          if (mark instanceof HTMLElement) {
            mark.style.backgroundColor = newColor.hex;
          }
        });
      }
    },
    []
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
    [activeHighlightId]
  );

  // Close delete popover
  const handleCloseDeletePopover = useCallback(() => {
    setActiveHighlightId(null);
    setDeletePopoverPosition(null);
  }, []);

  // Get current spine item ID
  const currentSpineItemId = book?.spine[currentChapterIndex]?.idref;

  const {
    showHighlightToolbar,
    toolbarPosition,
    handleHighlightColorSelect,
    handleCloseHighlightToolbar,
  } = useTextSelection(
    contentRef,
    bookId,
    currentSpineItemId,
    handleHighlightCreate
  );

  const { goToPreviousChapter, goToNextChapter, goToChapterByHref } =
    useChapterNavigation(
      book,
      bookId,
      currentChapterIndex,
      setCurrentChapterIndex
    );

  useReadingProgress(bookId, book, currentChapterIndex, lastScrollProgress);
  useKeyboardNavigation(goToPreviousChapter, goToNextChapter);

  // Early returns
  if (isLoading) return <LoadingSpinner />;
  if (!book) return null;

  // Derived state
  const activeHighlight = highlights.find((h) => h.id === activeHighlightId);
  const currentChapterTitle = getChapterTitleFromSpine(
    book,
    currentChapterIndex
  );
  const hasPreviousChapter = currentChapterIndex > 0;
  const hasNextChapter = currentChapterIndex < book.spine.length - 1;

  // Render
  return (
    <div className='flex flex-col bg-white min-h-screen'>
      <ReaderHeader
        book={book}
        currentChapterTitle={currentChapterTitle}
        currentChapterIndex={currentChapterIndex}
        totalChapters={book.spine.length}
        onToggleTOC={() => setIsTOCOpen(true)}
        onBackToLibrary={() => navigate('/')}
      />

      <TableOfContents
        toc={book.toc}
        isOpen={isTOCOpen}
        onOpenChange={setIsTOCOpen}
        onNavigate={goToChapterByHref}
      />

      <ReaderContent
        content={chapterContent}
        chapterIndex={currentChapterIndex}
        title={currentChapterTitle}
        ref={contentRef}
        onHighlightClick={handleHighlightClick}
        activeHighlightId={activeHighlightId}
      />

      {showHighlightToolbar && (
        <HighlightToolbar
          position={toolbarPosition}
          onColorSelect={handleHighlightColorSelect}
          onClose={handleCloseHighlightToolbar}
        />
      )}

      {deletePopoverPosition && activeHighlight && (
        <HighlightDeletePopover
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
