import { Button } from "@/components/ui/button";
import { type Book } from "@/lib/db";
import { ArrowLeft, Menu } from "lucide-react";

/**
 * ReaderHeader Component
 *
 * Displays the book title, current chapter information, and navigation controls.
 * Includes a hamburger menu for TOC and a back-to-library button.
 */
export interface ReaderHeaderProps {
  book: Book;
  currentChapterTitle: string;
  currentChapterIndex: number;
  totalChapters: number;
  onToggleTOC: () => void;
  onBackToLibrary: () => void;
}

export function ReaderHeader({
  book,
  currentChapterTitle,
  currentChapterIndex,
  totalChapters,
  onToggleTOC,
  onBackToLibrary,
}: ReaderHeaderProps) {
  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-10">
      {/* Hamburger Menu */}
      <Button variant="ghost" size="icon" onClick={onToggleTOC} aria-label="Table of contents">
        <Menu className="h-5 w-5" />
      </Button>

      {/* Back to Library Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onBackToLibrary}
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
        {currentChapterIndex + 1} / {totalChapters}
      </div>
    </header>
  );
}
