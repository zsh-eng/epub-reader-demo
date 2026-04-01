import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useCallback, useState } from "react";
import { InspectorSection } from "./InspectorSection";

interface ChapterEntry {
  index: number;
  href: string;
  title: string;
}

interface NavigationSectionProps {
  currentPage: number;
  totalPages: number;
  paginationStatus: string;
  onGoToPage: (page: number) => void;
  onNextPage: () => void;
  onPrevPage: () => void;
  chapterEntries: ChapterEntry[];
  currentChapterIndex: number;
  chapterFirstPages: Map<number, number>;
}

export function NavigationSection({
  currentPage,
  totalPages,
  paginationStatus,
  onGoToPage,
  onPrevPage,
  onNextPage,
  chapterEntries,
  currentChapterIndex,
  chapterFirstPages,
}: NavigationSectionProps) {
  const [jumpInput, setJumpInput] = useState(String(currentPage));

  const handleJump = useCallback(() => {
    const parsed = Number.parseInt(jumpInput, 10);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(1, Math.min(parsed, totalPages));
    onGoToPage(clamped);
  }, [jumpInput, totalPages, onGoToPage]);

  const handleChapterSelect = useCallback(
    (value: string) => {
      const chapterIndex = Number.parseInt(value, 10);
      const firstPage = chapterFirstPages.get(chapterIndex);
      if (firstPage !== undefined) {
        onGoToPage(firstPage);
      }
    },
    [chapterFirstPages, onGoToPage],
  );

  const percentage =
    totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;

  return (
    <InspectorSection title="Navigation & Position">
      <div className="space-y-3 pb-1">
        {/* Page scrubber */}
        <div className="flex items-center gap-3">
          <Slider
            min={1}
            max={Math.max(1, totalPages)}
            value={[currentPage]}
            onValueChange={([v]) => {
              if (v !== undefined) onGoToPage(v);
            }}
            className="flex-1"
          />
          <span className="text-xs tabular-nums text-muted-foreground w-10 text-right shrink-0">
            {currentPage}
          </span>
        </div>

        {/* Prev / Next */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onPrevPage}
            disabled={currentPage <= 1}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onNextPage}
            disabled={currentPage >= totalPages}
          >
            Next
          </Button>
        </div>

        {/* Jump input */}
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            max={totalPages}
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleJump();
            }}
            className="h-8 flex-1"
          />
          <Button variant="secondary" size="sm" onClick={handleJump}>
            Go
          </Button>
        </div>

        {/* Chapter dropdown */}
        {chapterEntries.length > 0 && (
          <Select
            value={String(currentChapterIndex)}
            onValueChange={handleChapterSelect}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chapterEntries.map((ch) => (
                <SelectItem key={ch.index} value={String(ch.index)}>
                  <span className="truncate">{ch.title}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Position readout */}
        <p className="text-xs tabular-nums text-muted-foreground">
          Page {currentPage} / {totalPages}
          {paginationStatus === "partial" && "~"} ({percentage}%)
        </p>

        <p className="text-[10px] text-muted-foreground/60">
          Arrow keys (left / right) to turn pages
        </p>
      </div>
    </InspectorSection>
  );
}
