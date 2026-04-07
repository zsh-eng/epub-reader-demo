import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ReaderSettings } from "@/types/reader.types";
import { cn } from "@/lib/utils";
import { Columns2, Palette, Settings, Type } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ThemePanel } from "../../Reader/ReaderSettings/ThemePanel";
import { TypographyPanel } from "../../Reader/ReaderSettings/TypographyPanel";

interface ReaderV2SettingsPopoverProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  showColumnSelector: boolean;
  spreadColumns: 1 | 2;
  onSpreadColumnsChange: (columns: 1 | 2) => void;
}

export function ReaderV2SettingsPopover({
  settings,
  onUpdateSettings,
  showColumnSelector,
  spreadColumns,
  onSpreadColumnsChange,
}: ReaderV2SettingsPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
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
            className="p-0 w-[min(96vw,28rem)]"
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{
                duration: 0.2,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="rounded-xl border bg-background/95 shadow-lg backdrop-blur-md overflow-hidden"
            >
              <Tabs defaultValue="typography" className="flex flex-col">
                <div className="max-h-[70vh] overflow-y-auto px-4 py-4 pb-2">
                  <TabsContent value="typography" className="mt-0">
                    <TypographyPanel
                      settings={settings}
                      onUpdateSettings={onUpdateSettings}
                    />
                  </TabsContent>

                  <TabsContent value="theme" className="mt-0">
                    <ThemePanel
                      settings={settings}
                      onUpdateSettings={onUpdateSettings}
                    />
                  </TabsContent>
                </div>

                {showColumnSelector && (
                  <div className="border-t px-4 pt-3 pb-2">
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <Columns2 className="size-3.5" />
                      Columns
                    </div>
                    <ToggleGroup
                      type="single"
                      value={String(spreadColumns)}
                      onValueChange={(value) => {
                        if (value === "1" || value === "2") {
                          onSpreadColumnsChange(
                            Number.parseInt(value, 10) as 1 | 2,
                          );
                        }
                      }}
                      className="w-full"
                    >
                      <ToggleGroupItem value="1" className="h-8 flex-1">
                        1
                      </ToggleGroupItem>
                      <ToggleGroupItem value="2" className="h-8 flex-1">
                        2
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                )}

                <TabsList className="mx-4 mb-4 mt-2 w-auto">
                  <TabsTrigger value="typography" className="gap-2 flex-1">
                    <Type className="size-4" />
                    Typography
                  </TabsTrigger>
                  <TabsTrigger value="theme" className="gap-2 flex-1">
                    <Palette className="size-4" />
                    Theme
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </motion.div>
          </PopoverContent>
        )}
      </AnimatePresence>
    </Popover>
  );
}
