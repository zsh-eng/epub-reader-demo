import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ReaderSettings } from "@/types/reader.types";
import { Palette, Type } from "lucide-react";
import { ThemePanel } from "@/components/ReaderShared/ReaderSettings/ThemePanel";
import { TypographyPanel } from "@/components/ReaderShared/ReaderSettings/TypographyPanel";

export type ReaderSettingsPanelTab = "typography" | "theme";

interface ReaderSettingsSheetProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  activeTab: ReaderSettingsPanelTab;
  onActiveTabChange: (tab: ReaderSettingsPanelTab) => void;
}

export function ReaderSettingsPanel({
  settings,
  onUpdateSettings,
  activeTab,
  onActiveTabChange,
}: ReaderSettingsSheetProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onActiveTabChange(value as ReaderSettingsPanelTab)}
      className="flex min-h-0 flex-col"
    >
      <TabsList className="mx-4 mb-3 grid h-auto grid-cols-2 rounded-full bg-secondary/50 p-1">
        <TabsTrigger
          value="typography"
          className="gap-2 rounded-full text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground data-[state=active]:text-foreground"
        >
          <Type className="size-4" />
          Typography
        </TabsTrigger>
        <TabsTrigger
          value="theme"
          className="gap-2 rounded-full text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground data-[state=active]:text-foreground"
        >
          <Palette className="size-4" />
          Theme
        </TabsTrigger>
      </TabsList>

      {/* This region stays content-sized until the sheet reaches its viewport
          cap, then becomes the scroll container instead of truncating the
          active settings panel at a fixed intermediate height. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3" data-vaul-no-drag>
        <TabsContent value="typography" className="mt-0">
          <TypographyPanel
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            showContentWidthControl={false}
          />
        </TabsContent>
        <TabsContent value="theme" className="mt-0">
          <ThemePanel settings={settings} onUpdateSettings={onUpdateSettings} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
