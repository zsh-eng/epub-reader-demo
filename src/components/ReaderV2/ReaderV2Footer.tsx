import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ReaderV2FooterProps {
  chromeVisible: boolean;
  currentPageLabel: string;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
}

export function ReaderV2Footer({
  chromeVisible,
  currentPageLabel,
  canGoPrev,
  canGoNext,
  onPrevPage,
  onNextPage,
}: ReaderV2FooterProps) {
  return (
    <div
      className="absolute bottom-0 inset-x-0 z-20 flex items-center justify-center pt-2"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom), 0.625rem)",
        opacity: chromeVisible ? 1 : 0,
        pointerEvents: chromeVisible ? "auto" : "none",
      }}
    >
      <div className="flex items-center gap-2 rounded-full border bg-background/90 p-1.5 shadow backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous page"
          onClick={onPrevPage}
          disabled={!canGoPrev}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-24 px-2 text-center text-xs tabular-nums text-muted-foreground">
          {currentPageLabel}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next page"
          onClick={onNextPage}
          disabled={!canGoNext}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
