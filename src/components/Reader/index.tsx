import { HighlightToolbar } from "@/components/HighlightToolbar";
import { LoadingSpinner } from "@/components/Reader/LoadingSpinner";
import { NavigationButtons } from "@/components/Reader/NavigationButtons";
import { ReaderHeader } from "@/components/Reader/ReaderHeader";
import { TableOfContents } from "@/components/Reader/TableOfContents";
import ReaderContent from "@/components/ReaderContent";
import { useBookLoader } from "@/hooks/use-book-loader";
import { useChapterContent } from "@/hooks/use-chapter-content";
import { useChapterNavigation } from "@/hooks/use-chapter-navigation";
import { useKeyboardNavigation } from "@/hooks/use-keyboard-navigation";
import { useReadingProgress } from "@/hooks/use-reading-progress";
import { useTextSelection } from "@/hooks/use-text-selection";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import { useRef, useState } from "react";
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

  // Custom hooks - all complex logic extracted
  const {
    book,
    currentChapterIndex,
    setCurrentChapterIndex,
    isLoading,
    lastScrollProgress,
  } = useBookLoader(bookId);

  const { chapterContent } = useChapterContent(
    book,
    bookId,
    currentChapterIndex,
  );

  const {
    showHighlightToolbar,
    toolbarPosition,
    handleHighlightColorSelect,
    handleCloseHighlightToolbar,
  } = useTextSelection(contentRef);

  const { goToPreviousChapter, goToNextChapter, goToChapterByHref } =
    useChapterNavigation(
      book,
      bookId,
      currentChapterIndex,
      setCurrentChapterIndex,
    );

  useReadingProgress(bookId, book, currentChapterIndex, lastScrollProgress);
  useKeyboardNavigation(goToPreviousChapter, goToNextChapter);

  // Early returns
  if (isLoading) return <LoadingSpinner />;
  if (!book) return null;

  // Derived state
  const currentChapterTitle = getChapterTitleFromSpine(
    book,
    currentChapterIndex,
  );
  const hasPreviousChapter = currentChapterIndex > 0;
  const hasNextChapter = currentChapterIndex < book.spine.length - 1;

  // Render
  return (
    <div className="flex flex-col bg-white min-h-screen">
      <ReaderHeader
        book={book}
        currentChapterTitle={currentChapterTitle}
        currentChapterIndex={currentChapterIndex}
        totalChapters={book.spine.length}
        onToggleTOC={() => setIsTOCOpen(true)}
        onBackToLibrary={() => navigate("/")}
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
        ref={contentRef}
      />

      {showHighlightToolbar && (
        <HighlightToolbar
          position={toolbarPosition}
          onColorSelect={handleHighlightColorSelect}
          onClose={handleCloseHighlightToolbar}
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
