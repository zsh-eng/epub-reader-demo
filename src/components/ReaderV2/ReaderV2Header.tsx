import { Button } from "@/components/ui/button";
import type { ReaderSettings } from "@/types/reader.types";
import { ArrowLeft } from "lucide-react";
import { ReaderV2SettingsPopover } from "./shared/ReaderV2SettingsPopover";

interface ReaderV2HeaderProps {
  chromeVisible: boolean;
  bookTitle: string;
  currentPageLabel: string;
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
  currentPageLabel,
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
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBackToLibrary}
          aria-label="Back to library"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <div className="min-w-0 flex-1 px-2">
          <p className="truncate text-sm font-medium">{bookTitle}</p>
          <p className="text-xs text-muted-foreground">{currentPageLabel}</p>
        </div>

        <ReaderV2SettingsPopover
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          showColumnSelector={showColumnSelector}
          spreadColumns={spreadColumns}
          onSpreadColumnsChange={onSpreadColumnsChange}
        />
      </div>
    </header>
  );
}
