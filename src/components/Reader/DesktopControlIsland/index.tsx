import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  GroupedTooltip,
  GroupedTooltipContent,
  GroupedTooltipTrigger,
  TooltipGroup,
} from "@/components/ui/tooltip-group";
import type { ReadingStatus, TOCItem } from "@/lib/db";
import { cn } from "@/lib/utils";
import type { ReaderSettings } from "@/types/reader.types";
import { ArrowLeft, ArrowRight, CheckCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Kbd } from "../../ui/kbd";
import { ChapterTitle } from "./ChapterTitle";
import { SettingsPopover } from "./SettingsPopover";
import { TOCPopover } from "./TOCPopover";

export interface DesktopControlIslandProps {
  // Navigation
  onBack: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPreviousChapter: boolean;
  hasNextChapter: boolean;

  // Chapter info
  currentChapterIndex: number;
  totalChapters: number;
  currentChapterTitle?: string;

  // TOC
  toc: TOCItem[];
  currentChapterHref: string;
  onNavigateToChapter: (href: string) => void;

  // Settings
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;

  // Reading status
  readingStatus: ReadingStatus | null;
  onMarkAsFinished?: () => void;
}

/**
 * useControlIslandVisibility Hook
 *
 * Determines when to show the control island:
 * - Always shows when page is short (doesn't scroll)
 * - Shows at top of page
 * - Shows when scrolling up
 * - Hides when scrolling down
 */
function useControlIslandVisibility(threshold = 100) {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    let ticking = false;

    const updateVisibility = () => {
      const currentScrollY = window.scrollY;
      const documentHeight = document.documentElement.scrollHeight;
      const windowHeight = window.innerHeight;

      // If page doesn't scroll (content fits in viewport), always show
      if (documentHeight <= windowHeight + 10) {
        setIsVisible(true);
        ticking = false;
        return;
      }

      // Always show at the very top
      if (currentScrollY < threshold) {
        setIsVisible(true);
        setLastScrollY(currentScrollY);
        ticking = false;
        return;
      }

      // Determine direction
      const isScrollingDown = currentScrollY > lastScrollY;
      const scrollDifference = Math.abs(currentScrollY - lastScrollY);

      // Only toggle if we've scrolled a significant amount to avoid jitter
      if (scrollDifference > 50) {
        setIsVisible(!isScrollingDown);
        setLastScrollY(currentScrollY);
      }

      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateVisibility);
        ticking = true;
      }
    };

    // Initial check
    updateVisibility();

    window.addEventListener("scroll", onScroll);
    window.addEventListener("resize", updateVisibility);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updateVisibility);
    };
  }, [lastScrollY, threshold]);

  return isVisible;
}

/**
 * DesktopControlIsland Component
 *
 * A floating control bar at the bottom of the screen that consolidates
 * all reader controls: navigation, chapter title, TOC, and settings.
 *
 * Features:
 * - Auto-hides on scroll down, appears on scroll up
 * - Always visible when page doesn't scroll
 * - Glassmorphism styling
 * - Spring-based motion animations
 * - Grouped tooltips with keyboard shortcuts
 */
export function DesktopControlIsland({
  onBack,
  onPrevious,
  onNext,
  hasPreviousChapter,
  hasNextChapter,
  currentChapterIndex,
  totalChapters,
  currentChapterTitle,
  toc,
  currentChapterHref,
  onNavigateToChapter,
  settings,
  onUpdateSettings,
  readingStatus,
  onMarkAsFinished,
}: DesktopControlIslandProps) {
  const isVisible = useControlIslandVisibility();
  const isLastChapter = currentChapterIndex === totalChapters - 1;
  const showMarkAsFinished =
    isLastChapter && readingStatus !== "finished" && onMarkAsFinished;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{
            opacity: { duration: 0.2, ease: "easeOut" },
            y: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
          }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
        >
          <TooltipGroup delayDuration={500} skipDelayDuration={300}>
            <div
              className={cn(
                "flex items-center gap-1 p-2 rounded-full",
                "bg-background/80 backdrop-blur-md border shadow-lg",
                "transition-colors hover:bg-background/95",
              )}
            >
              {/* Back Button */}
              <GroupedTooltip id="back">
                <GroupedTooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onBack}
                    className="rounded-full"
                    aria-label="Back to library"
                  >
                    <X className="size-4" />
                  </Button>
                </GroupedTooltipTrigger>
                <GroupedTooltipContent side="top" sideOffset={8}>
                  <div className="flex items-center gap-2">
                    <span>Back to library</span>
                    <Kbd>Esc</Kbd>
                  </div>
                </GroupedTooltipContent>
              </GroupedTooltip>

              <Separator orientation="vertical" className="h-6 mx-1" />

              {/* Previous Chapter Button */}
              <GroupedTooltip id="previous">
                <GroupedTooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onPrevious}
                    disabled={!hasPreviousChapter}
                    className="rounded-full disabled:opacity-50"
                    aria-label="Previous chapter"
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                </GroupedTooltipTrigger>
                <GroupedTooltipContent side="top" sideOffset={8}>
                  <div className="flex items-center gap-2">
                    <span>Previous chapter</span>
                    <Kbd>←</Kbd>
                  </div>
                </GroupedTooltipContent>
              </GroupedTooltip>

              {/* Chapter Title */}
              <ChapterTitle currentChapterTitle={currentChapterTitle} />

              {/* Next Chapter Button */}
              <GroupedTooltip id="next">
                <GroupedTooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onNext}
                    disabled={!hasNextChapter}
                    className="rounded-full disabled:opacity-50"
                    aria-label="Next chapter"
                  >
                    <ArrowRight className="size-4" />
                  </Button>
                </GroupedTooltipTrigger>
                <GroupedTooltipContent side="top" sideOffset={8}>
                  <div className="flex items-center gap-2">
                    <span>Next chapter</span>
                    <Kbd>→</Kbd>
                  </div>
                </GroupedTooltipContent>
              </GroupedTooltip>

              <Separator orientation="vertical" className="h-6 mx-1" />

              {/* Mark as Finished Button - only show on last chapter */}
              {showMarkAsFinished && (
                <>
                  <GroupedTooltip id="finish">
                    <GroupedTooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onMarkAsFinished}
                        className="rounded-full text-green-600 hover:text-green-700 hover:bg-green-100 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-900/30"
                        aria-label="Mark as Finished"
                      >
                        <CheckCircle className="size-4" />
                      </Button>
                    </GroupedTooltipTrigger>
                    <GroupedTooltipContent side="top" sideOffset={8}>
                      <span>Mark as Finished</span>
                    </GroupedTooltipContent>
                  </GroupedTooltip>
                  <Separator orientation="vertical" className="h-6 mx-1" />
                </>
              )}

              {/* TOC Popover */}
              <TOCPopover
                toc={toc}
                currentChapterHref={currentChapterHref}
                onNavigateToChapter={onNavigateToChapter}
              />

              {/* Settings Popover */}
              <SettingsPopover
                settings={settings}
                onUpdateSettings={onUpdateSettings}
              />
            </div>
          </TooltipGroup>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
