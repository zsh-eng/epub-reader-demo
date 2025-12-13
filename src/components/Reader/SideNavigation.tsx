import { Button } from "@/components/ui/button";
import {
  GroupedTooltip,
  GroupedTooltipContent,
  GroupedTooltipTrigger,
  TooltipGroup,
} from "@/components/ui/tooltip-group";
import { ArrowLeft, ChevronDown, ChevronUp, X } from "lucide-react";
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
      <div className="fixed left-4 top-6 z-40 flex flex-col gap-2">
        {/* Back to Library Button */}
        <GroupedTooltip id="back">
          <GroupedTooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={onBack}
              aria-label="Back to library"
              className="rounded-lg bg-background/80 backdrop-blur-sm border border-border hover:bg-accent transition-transform active:scale-95 active:duration-75 duration-150 ease-out"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </GroupedTooltipTrigger>
          <GroupedTooltipContent side="right" sideOffset={8}>
            <div className="flex items-center gap-2">
              <span>Back to library</span>
              <Kbd>Esc</Kbd>
            </div>
          </GroupedTooltipContent>
        </GroupedTooltip>

        {/* Previous Chapter Button */}
        <GroupedTooltip id="previous">
          <GroupedTooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={onPrevious}
              disabled={!hasPreviousChapter}
              aria-label="Previous chapter"
              className="rounded-lg bg-background/80 backdrop-blur-sm border border-border hover:bg-accent disabled:opacity-50 transition-transform active:scale-95 active:duration-75 duration-150 ease-out"
            >
              <ChevronUp className="h-5 w-5" />
            </Button>
          </GroupedTooltipTrigger>
          <GroupedTooltipContent side="right" sideOffset={8}>
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
              className="rounded-lg bg-background/80 backdrop-blur-sm border border-border hover:bg-accent disabled:opacity-50 transition-transform active:scale-95 active:duration-75 duration-150 ease-out"
            >
              <ChevronDown className="h-5 w-5" />
            </Button>
          </GroupedTooltipTrigger>
          <GroupedTooltipContent side="right" sideOffset={8}>
            <div className="flex items-center gap-2">
              <span>Next chapter</span>
              <Kbd>→</Kbd>
            </div>
          </GroupedTooltipContent>
        </GroupedTooltip>
      </div>
    </TooltipGroup>
  );
}
