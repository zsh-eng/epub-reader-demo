import { ThemePanel } from "@/components/ReaderShared/ReaderSettings/ThemePanel";
import { TypographyPanel } from "@/components/ReaderShared/ReaderSettings/TypographyPanel";
import { Button } from "@/components/ui/button";
import {
  SegmentedTabs,
  SegmentedTabsContent,
  SegmentedTabsList,
  SegmentedTabsTrigger,
} from "@/components/ui/segmented-controls";
import type { ReaderSettings } from "@/types/reader.types";
import { Palette, Type, X } from "lucide-react";
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
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

export function ReaderSettingsSheet({
  isOpen,
  onClose,
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
      bodyClassName="overflow-hidden"
      header={
        <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close settings"
            className="size-8 rounded-full border border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
          >
            <X className="size-4" />
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
      onValueChange={(value) => onActiveTabChange(value as ReaderSettingsPanelTab)}
      className="flex min-h-0 flex-col h-[30rem] mt-3"
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3" data-vaul-no-drag>
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
      </div>
    </SegmentedTabs>
  );
}
