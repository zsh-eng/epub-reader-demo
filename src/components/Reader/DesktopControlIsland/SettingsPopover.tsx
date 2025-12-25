import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ReaderSettings } from "@/types/reader.types";
import { Palette, Settings, Type } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ThemePanel } from "../ReaderSettings/ThemePanel";
import { TypographyPanel } from "../ReaderSettings/TypographyPanel";

interface SettingsPopoverProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

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

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
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
            sideOffset={12}
            align="end"
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
              className="rounded-xl bg-background/95 backdrop-blur-md border shadow-lg overflow-hidden"
            >
              <Tabs defaultValue="typography" className="flex flex-col">
                <div className="p-4 max-h-[50vh]">
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

                <TabsList className="mx-4 mb-4 w-auto">
                  <TabsTrigger value="typography" className="gap-2 flex-1">
                    <Type className="h-4 w-4" />
                    Typography
                  </TabsTrigger>
                  <TabsTrigger value="theme" className="gap-2 flex-1">
                    <Palette className="h-4 w-4" />
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
