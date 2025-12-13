import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useScrollVisibility } from "@/hooks/use-scroll-visibility";
import { cn } from "@/lib/utils";
import type { ReaderSettings } from "@/types/reader.types";
import { Palette, Type } from "lucide-react";
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
        "fixed bottom-0 left-1/2 -translate-x-1/2 z-50 transition-transform duration-300 pb-4 ease-out",
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
            className="flex items-center gap-1 p-2 rounded-full bg-background/80 backdrop-blur-md border shadow-lg md:transition-colors hover:bg-background/95"
          >
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
