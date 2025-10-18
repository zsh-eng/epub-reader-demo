import { HighlightToolbar } from "@/components/HighlightToolbar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useBookLoader } from "@/hooks/use-book-loader";
import { useChapterContent } from "@/hooks/use-chapter-content";
import { useChapterNavigation } from "@/hooks/use-chapter-navigation";
import { useKeyboardNavigation } from "@/hooks/use-keyboard-navigation";
import { useReadingProgress } from "@/hooks/use-reading-progress";
import { useTextSelection } from "@/hooks/use-text-selection";
import { type TOCItem } from "@/lib/db";
import { ArrowLeft, ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReaderContent from "./ReaderContent";

export function Reader() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  const contentRef = useRef<HTMLDivElement>(null);
  const [isTOCOpen, setIsTOCOpen] = useState(false);

  // Load book and restore progress
  const {
    book,
    currentChapterIndex,
    setCurrentChapterIndex,
    isLoading,
    lastScrollProgress,
  } = useBookLoader(bookId);

  // Load chapter content
  const { chapterContent } = useChapterContent(
    book,
    bookId,
    currentChapterIndex,
  );

  // Handle text selection and highlights
  const {
    showHighlightToolbar,
    toolbarPosition,
    handleHighlightColorSelect,
    handleCloseHighlightToolbar,
  } = useTextSelection(contentRef);

  // Chapter navigation
  const { goToPreviousChapter, goToNextChapter, goToChapterByHref } =
    useChapterNavigation(
      book,
      bookId,
      currentChapterIndex,
      setCurrentChapterIndex,
    );

  // Auto-save reading progress
  useReadingProgress(bookId, book, currentChapterIndex, lastScrollProgress);

  // Keyboard navigation
  useKeyboardNavigation(goToPreviousChapter, goToNextChapter);

  // Helper function to find TOC item by href (searches recursively)
  const findTOCItemByHref = useCallback(
    (items: TOCItem[], targetHref: string): TOCItem | null => {
      for (const item of items) {
        // Check if this item matches (compare both full path and just filename)
        if (
          item.href === targetHref ||
          item.href.endsWith(targetHref) ||
          targetHref.endsWith(item.href)
        ) {
          return item;
        }
        // Recursively search children
        if (item.children && item.children.length > 0) {
          const found = findTOCItemByHref(item.children, targetHref);
          if (found) return found;
        }
      }
      return null;
    },
    [],
  );

  // Get current chapter title by mapping spine index to TOC
  const getCurrentChapterTitle = useCallback(() => {
    if (!book) return "";

    const spineItem = book.spine[currentChapterIndex];
    if (!spineItem) return "";

    // Find the manifest item to get the href
    const manifestItem = book.manifest.find(
      (item) => item.id === spineItem.idref,
    );
    if (!manifestItem) return "";

    // Find the corresponding TOC item
    const tocItem = findTOCItemByHref(book.toc, manifestItem.href);
    if (!tocItem) {
      return "";
    }

    return tocItem.label;
  }, [book, currentChapterIndex, findTOCItemByHref]);

  const handleBackToLibrary = () => {
    navigate("/");
  };

  const handleTOCNavigate = async (href: string) => {
    await goToChapterByHref(href);
    setIsTOCOpen(false);
  };

  // Render TOC items recursively
  const renderTOCItems = (items: TOCItem[], level = 0) => {
    return items.map((item, index) => (
      <div key={`${level}-${index}`} style={{ paddingLeft: `${level * 16}px` }}>
        <button
          onClick={() => handleTOCNavigate(item.href)}
          className="w-full text-left px-3 py-2 hover:bg-gray-100 rounded-none transition-colors text-sm"
        >
          {item.label}
        </button>
        {item.children &&
          item.children.length > 0 &&
          renderTOCItems(item.children, level + 1)}
      </div>
    ));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading book...</p>
        </div>
      </div>
    );
  }

  if (!book) {
    return null;
  }

  const currentChapterTitle = getCurrentChapterTitle();
  const hasPreviousChapter = currentChapterIndex > 0;
  const hasNextChapter = currentChapterIndex < book.spine.length - 1;

  return (
    <div className="flex flex-col bg-white">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-10">
        {/* Hamburger Menu */}
        <Sheet open={isTOCOpen} onOpenChange={setIsTOCOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Table of contents">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] sm:w-[400px]">
            <SheetHeader>
              <SheetTitle>Table of Contents</SheetTitle>
            </SheetHeader>
            <div className="overflow-scroll px-2">
              {book.toc && book.toc.length > 0 ? (
                <div className="space-y-1">{renderTOCItems(book.toc)}</div>
              ) : (
                <p className="text-sm text-gray-500 px-3">
                  No table of contents available
                </p>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* Back to Library Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBackToLibrary}
          aria-label="Back to library"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        {/* Book Info */}
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-base truncate">{book.title}</h1>
          <p className="text-xs text-gray-600 truncate">
            {currentChapterTitle}
          </p>
        </div>

        {/* Chapter Progress */}
        <div className="text-xs text-gray-500 hidden sm:block">
          {currentChapterIndex + 1} / {book.spine.length}
        </div>
      </header>

      <ReaderContent
        content={chapterContent}
        chapterIndex={currentChapterIndex}
        ref={contentRef}
      />

      {/* Highlight Toolbar */}
      {showHighlightToolbar && (
        <HighlightToolbar
          position={toolbarPosition}
          onColorSelect={handleHighlightColorSelect}
          onClose={handleCloseHighlightToolbar}
        />
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between px-4 py-4 border-t border-gray-200 bg-white">
        <Button
          variant="outline"
          onClick={goToPreviousChapter}
          disabled={!hasPreviousChapter}
          className="gap-2 w-28"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>

        <div className="text-sm text-gray-600">
          Chapter {currentChapterIndex + 1} of {book.spine.length}
        </div>

        <Button
          variant="outline"
          onClick={goToNextChapter}
          disabled={!hasNextChapter}
          className="gap-2 w-28"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
