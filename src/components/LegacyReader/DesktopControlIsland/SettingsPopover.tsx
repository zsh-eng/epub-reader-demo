import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SegmentedTabs,
  SegmentedTabsContent,
  SegmentedTabsList,
  SegmentedTabsTrigger,
} from "@/components/ui/segmented-controls";
import type { ReaderSettings } from "@/types/reader.types";
import { cn } from "@/lib/utils";
import { Palette, Settings, Type } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ThemePanel } from "@/components/ReaderShared/ReaderSettings/ThemePanel";
import { TypographyPanel } from "@/components/ReaderShared/ReaderSettings/TypographyPanel";

interface SettingsPopoverProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

type SettingsTab = "typography" | "theme";

/**
 * SettingsPopover Component
 *
 * A popover that shows Theme and Typography settings.
 * Reuses the existing panel components with a tab interface.
 */
export function SettingsPopover({
  settings,
  onUpdateSettings,
}: SettingsPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("typography");

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "rounded-full",
            isOpen && "bg-accent text-accent-foreground",
          )}
          aria-label="Settings"
        >
          <Settings className="size-4" />
        </Button>
      </PopoverTrigger>
      <AnimatePresence>
        {isOpen && (
          <PopoverContent
            asChild
            side="top"
            align="end"
            sideOffset={12}
            alignOffset={-40}
            className="p-0 w-lg"
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{
                duration: 0.2,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="flex h-[32rem] max-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur-md"
            >
              <SegmentedTabs
                value={activeTab}
                onValueChange={(nextValue) => {
                  if (nextValue === "typography" || nextValue === "theme") {
                    setActiveTab(nextValue);
                  }
                }}
                className="flex h-full flex-col"
              >
                {/* Keep the panel viewport stable so the tab row stays pinned. */}
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <SegmentedTabsContent
                    value="typography"
                    forceMount
                    aria-hidden={activeTab !== "typography"}
                    tabIndex={activeTab === "typography" ? 0 : -1}
                    className={cn(
                      "absolute inset-0 mt-0",
                      activeTab === "typography"
                        ? "pointer-events-auto z-10"
                        : "pointer-events-none z-0",
                    )}
                  >
                    <motion.div
                      initial={false}
                      animate={{
                        opacity: activeTab === "typography" ? 1 : 0,
                        y: activeTab === "typography" ? 0 : 6,
                      }}
                      transition={{
                        duration: 0.18,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="h-full overflow-y-auto p-4 pb-2"
                    >
                      <TypographyPanel
                        settings={settings}
                        onUpdateSettings={onUpdateSettings}
                      />
                    </motion.div>
                  </SegmentedTabsContent>

                  <SegmentedTabsContent
                    value="theme"
                    forceMount
                    aria-hidden={activeTab !== "theme"}
                    tabIndex={activeTab === "theme" ? 0 : -1}
                    className={cn(
                      "absolute inset-0 mt-0",
                      activeTab === "theme"
                        ? "pointer-events-auto z-10"
                        : "pointer-events-none z-0",
                    )}
                  >
                    <motion.div
                      initial={false}
                      animate={{
                        opacity: activeTab === "theme" ? 1 : 0,
                        y: activeTab === "theme" ? 0 : 6,
                      }}
                      transition={{
                        duration: 0.18,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="h-full overflow-y-auto p-4 pb-2"
                    >
                      <ThemePanel
                        settings={settings}
                        onUpdateSettings={onUpdateSettings}
                      />
                    </motion.div>
                  </SegmentedTabsContent>
                </div>

                <SegmentedTabsList className="mx-4 mb-4 w-auto shrink-0">
                  <SegmentedTabsTrigger
                    value="typography"
                    className="gap-2 flex-1"
                  >
                    <Type className="h-4 w-4" />
                    Typography
                  </SegmentedTabsTrigger>
                  <SegmentedTabsTrigger value="theme" className="gap-2 flex-1">
                    <Palette className="h-4 w-4" />
                    Theme
                  </SegmentedTabsTrigger>
                </SegmentedTabsList>
              </SegmentedTabs>
            </motion.div>
          </PopoverContent>
        )}
      </AnimatePresence>
    </Popover>
  );
}
