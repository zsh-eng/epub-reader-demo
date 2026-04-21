import { Button } from "@/components/ui/button";
import { CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * NavigationButtons Component
 *
 * Displays previous/next chapter navigation buttons with current chapter indicator.
 * Buttons are automatically disabled when at the beginning or end of the book.
 * Shows a "Mark as Finished" button when on the last chapter.
 */
export interface NavigationButtonsProps {
  currentChapterIndex: number;
  totalChapters: number;
  hasPreviousChapter: boolean;
  hasNextChapter: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onMarkAsFinished?: () => void;
  showMarkAsFinished?: boolean;
}

export function NavigationButtons({
  currentChapterIndex,
  totalChapters,
  hasPreviousChapter,
  hasNextChapter,
  onPrevious,
  onNext,
  onMarkAsFinished,
  showMarkAsFinished = false,
}: NavigationButtonsProps) {
  const isLastChapter = currentChapterIndex === totalChapters - 1;

  return (
    <div className="flex flex-col gap-3 px-4 py-4 border-t border-border bg-muted mt-auto animate-in slide-in-from-bottom duration-300">
      {/* Mark as Finished button - only show on last chapter when applicable */}
      {isLastChapter && showMarkAsFinished && onMarkAsFinished && (
        <Button
          variant="default"
          onClick={onMarkAsFinished}
          className="w-full gap-2"
        >
          <CheckCircle className="h-4 w-4" />
          Mark as Finished
        </Button>
      )}

      {/* Navigation row */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={onPrevious}
          disabled={!hasPreviousChapter}
          className="gap-2 w-28"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>

        <div className="text-sm text-muted-foreground">
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
    </div>
  );
}
