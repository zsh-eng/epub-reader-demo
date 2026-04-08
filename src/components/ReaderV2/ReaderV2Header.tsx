import { Button } from "@/components/ui/button";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { motion } from "motion/react";

interface ReaderV2HeaderProps {
  chromeVisible: boolean;
  bookTitle: string;
  onBackToLibrary: () => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  onOpenMenu: () => void;
}

export function ReaderV2Header({
  chromeVisible,
  bookTitle,
  onBackToLibrary,
  isBookmarked,
  onToggleBookmark,
  onOpenMenu,
}: ReaderV2HeaderProps) {
  return (
    <motion.header
      className="absolute top-0 inset-x-0 z-20 border-b bg-background/95 backdrop-blur-sm overflow-visible"
      animate={{ y: chromeVisible ? 0 : "-100%" }}
      transition={{ duration: 0.22, ease: [0.32, 0, 0.67, 0] }}
      style={{
        paddingTop: "env(safe-area-inset-top)",
        pointerEvents: chromeVisible ? "auto" : "none",
      }}
    >
      {/* Bookmark ribbon — hangs below header, peeks when header is hidden + bookmarked */}
      <div
        className="absolute right-5 top-0 w-7"
        style={{
          height: "calc(100% + 44px)",
          clipPath:
            "polygon(0 0, 100% 0, 100% calc(100% - 12px), 50% 100%, 0 calc(100% - 12px))",
          backgroundColor: isBookmarked ? "var(--foreground)" : "var(--border)",
          opacity: !isBookmarked && !chromeVisible ? 0 : 1,
          transition: "opacity 200ms, background-color 200ms",
          pointerEvents: "auto",
          cursor: "pointer",
        }}
        onClick={onToggleBookmark}
        role="button"
        aria-label={isBookmarked ? "Remove bookmark" : "Add bookmark"}
        aria-pressed={isBookmarked}
      />

      <div className="relative z-10 mx-auto grid h-14 max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-3 sm:px-4">
        {/* Zone 1 — Left: Back button */}
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBackToLibrary}
            aria-label="Back to library"
          >
            <ChevronLeft className="size-5" />
          </Button>
        </div>

        {/* Zone 2 — Center: Book title */}
        <p className="max-w-[40vw] truncate font-serif text-sm font-medium">
          {bookTitle}
        </p>

        {/* Zone 3 — Right: Menu button */}
        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenMenu}
            aria-label="Open menu"
            className="rounded-full"
          >
            <MoreHorizontal className="size-5" />
          </Button>
        </div>
      </div>
    </motion.header>
  );
}
