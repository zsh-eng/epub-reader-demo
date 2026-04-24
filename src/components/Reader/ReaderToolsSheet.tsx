import { Button } from "@/components/ui/button";
import type { TOCItem } from "@/lib/db";
import type { ReaderSettings } from "@/types/reader.types";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { ReaderControlMenu } from "./ReaderControlMenu";
import { ReaderContentsSheet } from "./ReaderContentsSheet";
import {
    ReaderSettingsPanel,
    type ReaderSettingsPanelTab,
} from "./ReaderSettingsSheet";
import { ReaderSheet } from "./shared/ReaderSheet";
import type { ChapterEntry } from "./types";

interface ReaderToolsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  toc: TOCItem[];
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentChapterHref: string;
  currentChapterTitle?: string;
  onNavigateToHref: (href: string) => boolean;
}

/**
 * ReaderToolsSheet uses a short launcher drawer for quick actions, then opens
 * deeper configuration in a nested drawer so each surface can keep a stable
 * height instead of resizing around mismatched content.
 */
export function ReaderToolsSheet({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  toc,
  chapterEntries,
  chapterStartPages,
  currentChapterHref,
  currentChapterTitle,
  onNavigateToHref,
}: ReaderToolsSheetProps) {
  const [isContentsOpen, setIsContentsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<ReaderSettingsPanelTab>("typography");

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setIsContentsOpen(false);
    setIsSettingsOpen(false);
  }, [isOpen]);

  const closeContentsSheet = () => {
    setIsContentsOpen(false);
  };

  const closeSettingsSheet = () => {
    setIsSettingsOpen(false);
  };

  return (
    <ReaderSheet
      open={isOpen}
      onOpenChange={(open) => {
        if (open) {
          return;
        }

        closeContentsSheet();
        closeSettingsSheet();
        onClose();
      }}
      title="Reader Tools"
      panelClassName="max-w-md"
    >
      <ReaderControlMenu
        onOpenContents={() => {
          closeSettingsSheet();
          setIsContentsOpen(true);
        }}
        onOpenSettings={() => {
          closeContentsSheet();
          setIsSettingsOpen(true);
        }}
      />

      <ReaderContentsSheet
        isOpen={isContentsOpen}
        onClose={closeContentsSheet}
        toc={toc}
        chapterEntries={chapterEntries}
        chapterStartPages={chapterStartPages}
        currentChapterHref={currentChapterHref}
        currentChapterTitle={currentChapterTitle}
        onNavigateToHref={(href) => {
          const handled = onNavigateToHref(href);
          if (!handled) {
            return false;
          }

          return true;
        }}
      />

      {/* The nested drawer grows to fit its content first, then falls back to
          the sheet max-height with internal scrolling once the content becomes
          taller than the available viewport. */}
      <ReaderSheet
        nested
        open={isSettingsOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsSettingsOpen(true);
            return;
          }

          closeSettingsSheet();
        }}
        title="Reading Settings"
        panelClassName="max-w-md"
        bodyClassName="overflow-hidden"
        header={
          <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={closeSettingsSheet}
              aria-label="Go back"
              className="size-8 rounded-full border border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </Button>

            <p className="truncate text-center text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Reading Settings
            </p>

            <div className="size-8" aria-hidden="true" />
          </div>
        }
      >
        <ReaderSettingsPanel
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          activeTab={activeSettingsTab}
          onActiveTabChange={setActiveSettingsTab}
        />
      </ReaderSheet>
    </ReaderSheet>
  );
}
