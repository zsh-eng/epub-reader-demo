import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * NavigationButtons Component
 *
 * Displays previous/next chapter navigation buttons with current chapter indicator.
 * Buttons are automatically disabled when at the beginning or end of the book.
 */
export interface NavigationButtonsProps {
  currentChapterIndex: number;
  totalChapters: number;
  hasPreviousChapter: boolean;
  hasNextChapter: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export function NavigationButtons({
  currentChapterIndex,
  totalChapters,
  hasPreviousChapter,
  hasNextChapter,
  onPrevious,
  onNext,
}: NavigationButtonsProps) {
  return (
    <div className="flex items-center justify-between px-4 py-4 border-t border-gray-200 bg-white">
      <Button
        variant="outline"
        onClick={onPrevious}
        disabled={!hasPreviousChapter}
        className="gap-2 w-28"
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </Button>

      <div className="text-sm text-gray-600">
        Chapter {currentChapterIndex + 1} of {totalChapters}
      </div>

      <Button
        variant="outline"
        onClick={onNext}
        disabled={!hasNextChapter}
        className="gap-2 w-28"
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
