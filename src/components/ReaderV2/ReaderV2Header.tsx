import { Button } from "@/components/ui/button";
import type { ReaderSettings } from "@/types/reader.types";
import { Bookmark, ChevronLeft, List, Search } from "lucide-react";
import { ReaderV2SettingsPopover } from "./shared/ReaderV2SettingsPopover";

interface ReaderV2HeaderProps {
  chromeVisible: boolean;
  bookTitle: string;
  onBackToLibrary: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  showColumnSelector: boolean;
  spreadColumns: 1 | 2;
  onSpreadColumnsChange: (columns: 1 | 2) => void;
}

export function ReaderV2Header({
  chromeVisible,
  bookTitle,
  onBackToLibrary,
  settings,
  onUpdateSettings,
  showColumnSelector,
  spreadColumns,
  onSpreadColumnsChange,
}: ReaderV2HeaderProps) {
  return (
    <header
      className="absolute top-0 inset-x-0 z-20 border-b bg-background/95 backdrop-blur-sm"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        opacity: chromeVisible ? 1 : 0,
        pointerEvents: chromeVisible ? "auto" : "none",
      }}
    >
      <div className="mx-auto grid h-14 max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-3 sm:px-4">

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

        {/* Zone 3 — Right: Pill cluster */}
        <div className="flex items-center justify-end">
          <div className="flex items-center gap-0.5 rounded-full bg-muted p-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label="Table of contents"
              onClick={() => {}}
            >
              <List className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label="Search"
              onClick={() => {}}
            >
              <Search className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label="Bookmark"
              onClick={() => {}}
            >
              <Bookmark className="size-4" />
            </Button>
            <ReaderV2SettingsPopover
              settings={settings}
              onUpdateSettings={onUpdateSettings}
              showColumnSelector={showColumnSelector}
              spreadColumns={spreadColumns}
              onSpreadColumnsChange={onSpreadColumnsChange}
            />
          </div>
        </div>

      </div>
    </header>
  );
}
