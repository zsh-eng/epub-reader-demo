interface ChapterTitleProps {
  currentChapterTitle?: string;
}

/**
 * ChapterTitle Component
 *
 * Displays the current chapter title in the control island.
 */
export function ChapterTitle({ currentChapterTitle }: ChapterTitleProps) {
  return (
    <div className="px-3 min-w-[120px] max-w-[280px]">
      <span className="text-sm text-muted-foreground truncate block text-center">
        {currentChapterTitle || "Untitled Chapter"}
      </span>
    </div>
  );
}
