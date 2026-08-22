import { ThemePanel } from "@/components/ReaderShared/ReaderSettings/ThemePanel";
import { TypographyPanel } from "@/components/ReaderShared/ReaderSettings/TypographyPanel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SegmentedTabs,
  SegmentedTabsContent,
  SegmentedTabsList,
  SegmentedTabsTrigger,
} from "@/components/ui/segmented-controls";
import type { ReaderSettings } from "@/types/reader.types";
import { ChevronLeft, Palette, Type } from "lucide-react";
import { useState } from "react";
import { ReaderSheet } from "./shared/ReaderSheet";

export type ReaderSettingsPanelTab = "typography" | "theme";

interface ReaderSettingsPanelProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  activeTab: ReaderSettingsPanelTab;
  onActiveTabChange: (tab: ReaderSettingsPanelTab) => void;
}

interface ReaderSettingsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onBack: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

export function ReaderSettingsSheet({
  isOpen,
  onClose,
  onBack,
  settings,
  onUpdateSettings,
}: ReaderSettingsSheetProps) {
  const [activeTab, setActiveTab] =
    useState<ReaderSettingsPanelTab>("typography");

  return (
    <ReaderSheet
      open={isOpen}
      onOpenChange={(open) => {
        if (open) {
          return;
        }

        onClose();
      }}
      title="Reading Settings"
      panelClassName="max-w-md"
      contentClassName="data-[drawer-direction=bottom]:mt-4 data-[drawer-direction=bottom]:max-h-[94dvh]"
      bodyClassName="w-full max-w-full overflow-hidden"
      header={
        <div className="flex h-8 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Back to reader tools"
            className="size-8 rounded-full border border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </Button>
        </div>
      }
    >
      <ReaderSettingsPanel
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
      />
    </ReaderSheet>
  );
}

export function ReaderSettingsPanel({
  settings,
  onUpdateSettings,
  activeTab,
  onActiveTabChange,
}: ReaderSettingsPanelProps) {
  return (
    <SegmentedTabs
      value={activeTab}
      onValueChange={(value) =>
        onActiveTabChange(value as ReaderSettingsPanelTab)
      }
      className="mt-3 flex h-[40rem] min-h-0 w-full max-w-full flex-col overflow-x-hidden"
    >
      <SegmentedTabsList className="mx-4 mb-3 grid h-auto grid-cols-2 rounded-full bg-secondary/50 p-1 self-center">
        <SegmentedTabsTrigger
          value="typography"
          className="h-10 gap-2 rounded-full text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground data-[state=active]:text-foreground"
        >
          <Type className="size-4" />
          Typography
        </SegmentedTabsTrigger>
        <SegmentedTabsTrigger
          value="theme"
          className="h-10 gap-2 rounded-full text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground data-[state=active]:text-foreground"
        >
          <Palette className="size-4" />
          Theme
        </SegmentedTabsTrigger>
      </SegmentedTabsList>

      {/* This region stays content-sized until the sheet reaches its viewport
          cap, then becomes the scroll container instead of truncating the
          active settings panel at a fixed intermediate height. */}
      <ScrollArea
        className="min-h-0 w-full max-w-full flex-1 px-4 pb-3"
        viewportClassName="overflow-x-hidden"
        contentClassName="min-w-0 max-w-full overflow-x-hidden"
      >
        <SegmentedTabsContent value="typography" className="mt-0">
          <TypographyPanel
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            showContentWidthControl={false}
          />
        </SegmentedTabsContent>
        <SegmentedTabsContent value="theme" className="mt-0">
          <ThemePanel settings={settings} onUpdateSettings={onUpdateSettings} />
        </SegmentedTabsContent>
      </ScrollArea>
    </SegmentedTabs>
  );
}
