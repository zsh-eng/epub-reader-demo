import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useScrollVisibility } from "@/hooks/use-scroll-visibility";
import { cn } from "@/lib/utils";
import type { ReaderSettings } from "@/types/reader.types";
import { Minus, Palette, Plus, Type } from "lucide-react";
import { useRef, useState } from "react";
import { ThemePanel } from "./ReaderSettings/ThemePanel";
import { TypographyPanel } from "./ReaderSettings/TypographyPanel";

interface ReaderSettingsBarProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

type Panel = "theme" | "typography" | null;

export function ReaderSettingsBar({
  settings,
  onUpdateSettings,
}: ReaderSettingsBarProps) {
  const [activePanel, setActivePanel] = useState<Panel>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isVisible = useScrollVisibility();

  const handlePanelToggle = (panel: Panel) => {
    setActivePanel(activePanel === panel ? null : panel);
  };

  return (
    <div
      className={cn(
        "fixed bottom-0 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 pb-4",
        isVisible || activePanel !== null
          ? "translate-y-0"
          : "translate-y-[150%]",
      )}
    >
      <Popover
        open={activePanel !== null}
        onOpenChange={(open) => !open && setActivePanel(null)}
      >
        <PopoverAnchor>
          <div
            ref={menuRef}
            className="flex items-center gap-1 p-2 rounded-full bg-background/80 backdrop-blur-md border shadow-lg transition-all hover:bg-background/95"
          >
            {/* Font Size Controls */}
            <div className="flex items-center gap-3 sm:gap-2">
              <Button
                variant="ghost"
                size="icon-lg"
                className="rounded-full"
                onClick={() =>
                  onUpdateSettings({
                    fontSize: Math.max(50, settings.fontSize - 10),
                  })
                }
                disabled={settings.fontSize <= 50}
              >
                <Minus className="size-5 sm:size-4" />
                <span className="sr-only">Decrease font size</span>
              </Button>
              <span className="text-sm sm:text-xs font-medium text-center tabular-nums">
                {settings.fontSize}%
              </span>
              <Button
                variant="ghost"
                size="icon-lg"
                className="rounded-full"
                onClick={() =>
                  onUpdateSettings({
                    fontSize: Math.min(200, settings.fontSize + 10),
                  })
                }
                disabled={settings.fontSize >= 200}
              >
                <Plus className="size-5 sm:size-4" />
                <span className="sr-only">Increase font size</span>
              </Button>
            </div>

            <Separator orientation="vertical" className="h-6 mx-1" />

            {/* Theme Button */}
            <Button
              variant="ghost"
              size="icon-lg"
              className={cn(
                "rounded-full",
                activePanel === "theme" && "bg-accent",
              )}
              onClick={() => handlePanelToggle("theme")}
            >
              <Palette className="size-5 sm:size-4" />
              <span className="sr-only">Theme</span>
            </Button>

            {/* Typography Button */}
            <Button
              variant="ghost"
              size="icon-lg"
              className={cn(
                "rounded-full",
                activePanel === "typography" && "bg-accent",
              )}
              onClick={() => handlePanelToggle("typography")}
            >
              <Type className="size-5 sm:size-4" />
              <span className="sr-only">Typography</span>
            </Button>
          </div>
        </PopoverAnchor>

        <PopoverContent
          className="w-[95vw] mx-2 sm:w-md p-6 rounded-3xl bg-background/80 backdrop-blur-md border shadow-lg"
          alignOffset={20}
          onInteractOutside={(e) => {
            if (menuRef.current && menuRef.current.contains(e.target as Node)) {
              e.preventDefault();
            }
          }}
        >
          {activePanel === "theme" && (
            <ThemePanel
              settings={settings}
              onUpdateSettings={onUpdateSettings}
            />
          )}

          {activePanel === "typography" && (
            <TypographyPanel
              settings={settings}
              onUpdateSettings={onUpdateSettings}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
