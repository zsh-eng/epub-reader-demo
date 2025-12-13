import { Button } from "@/components/ui/button";
import {
  GroupedTooltip,
  GroupedTooltipContent,
  GroupedTooltipTrigger,
  TooltipGroup,
} from "@/components/ui/tooltip-group";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { Kbd } from "../ui/kbd";

export interface SideNavigationProps {
  onBack: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPreviousChapter: boolean;
  hasNextChapter: boolean;
}

/**
 * SideNavigation Component
 *
 * Fixed vertical navigation panel on the left side with:
 * - Back button (X) to return to library
 * - Previous chapter button (up arrow)
 * - Next chapter button (down arrow)
 *
 * Features grouped tooltips that show instantly after the first one is displayed.
 */
export function SideNavigation({
  onBack,
  onPrevious,
  onNext,
  hasPreviousChapter,
  hasNextChapter,
}: SideNavigationProps) {
  return (
    <TooltipGroup delayDuration={500} skipDelayDuration={300}>
      <div className="fixed right-4 top-4 z-40 flex">
        {/* Previous Chapter Button */}
        <GroupedTooltip id="previous">
          <GroupedTooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={onPrevious}
              disabled={!hasPreviousChapter}
              aria-label="Previous chapter"
              className="w-12 rounded-l-lg bg-background/80 backdrop-blur-sm border-l-0 border border-border hover:bg-accent disabled:opacity-50 transition-transform active:scale-95 active:duration-75 duration-150 ease-out"
            >
              <ArrowLeft className="" />
            </Button>
          </GroupedTooltipTrigger>
          <GroupedTooltipContent side="bottom" sideOffset={8}>
            <div className="flex items-center gap-2">
              <span>Previous chapter</span>
              <Kbd>←</Kbd>
            </div>
          </GroupedTooltipContent>
        </GroupedTooltip>

        {/* Next Chapter Button */}
        <GroupedTooltip id="next">
          <GroupedTooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={onNext}
              disabled={!hasNextChapter}
              aria-label="Next chapter"
              className="w-12 rounded-r-lg rounded-l-none bg-background/80 backdrop-blur-sm border-l-0 border border-border hover:bg-accent disabled:opacity-50 transition-transform active:scale-95 active:duration-75 duration-150 ease-out"
            >
              <ArrowRight className="" />
            </Button>
          </GroupedTooltipTrigger>
          <GroupedTooltipContent side="bottom" sideOffset={8}>
            <div className="flex items-center gap-2">
              <span>Next chapter</span>
              <Kbd>→</Kbd>
            </div>
          </GroupedTooltipContent>
        </GroupedTooltip>

        {/* Back to Library Button */}
        <GroupedTooltip id="back">
          <GroupedTooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={onBack}
              aria-label="Back to library"
              className="rounded-lg ml-2 bg-background/80 backdrop-blur-sm hover:bg-accent transition-transform active:scale-95 active:duration-75 duration-150 ease-out"
            >
              <X className="h-5 w-5" />
            </Button>
          </GroupedTooltipTrigger>
          <GroupedTooltipContent side="bottom" sideOffset={8}>
            <div className="flex items-center gap-2">
              <span>Back to library</span>
              <Kbd>Esc</Kbd>
            </div>
          </GroupedTooltipContent>
        </GroupedTooltip>
      </div>
    </TooltipGroup>
  );
}
