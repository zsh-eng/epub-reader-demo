import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useScrollVisibility } from "@/hooks/use-scroll-visibility";
import { cn } from "@/lib/utils";
import type { ReaderSettings } from "@/types/reader.types";
import {
  ChevronLeft,
  ChevronRight,
  Palette,
  Settings,
  Type,
  X,
} from "lucide-react";
import { useState } from "react";
import { ThemePanel } from "./ReaderSettings/ThemePanel";
import { TypographyPanel } from "./ReaderSettings/TypographyPanel";

interface MobileReaderNavProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  onBack: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPreviousChapter: boolean;
  hasNextChapter: boolean;
  isVisible: boolean;
}

export function MobileReaderNav({
  settings,
  onUpdateSettings,
  onBack,
  onPrevious,
  onNext,
  hasPreviousChapter,
  hasNextChapter,
  isVisible,
}: MobileReaderNavProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <>
      {/* Back to Library Button - Top Right */}
      <div className="fixed right-4 top-4 z-40">
        <Button
          variant="ghost"
          size="icon"
          onPointerDown={onBack}
          aria-label="Back to library"
          className={cn(
            "h-10 w-10 rounded-full bg-background/80 backdrop-blur-md border shadow-lg transition-[transform,opacity] active:scale-95 active:duration-75 duration-150 ease-out",
            isVisible ? "opacity-100" : "opacity-0",
          )}
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Bottom Navigation Bar */}
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 pt-2 transition-transform duration-300 ease-out",
          isVisible || isDrawerOpen ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          {/* Previous Chapter Button - Circular */}
          <Button
            variant="outline"
            size="icon"
            onPointerDown={onPrevious}
            disabled={!hasPreviousChapter}
            aria-label="Previous chapter"
            className="h-12 w-12 rounded-full bg-background/80 backdrop-blur-md border shadow-lg disabled:opacity-50 transition-transform active:scale-95 active:duration-75 duration-150 ease-out shrink-0"
          >
            <ChevronLeft className="size-5" />
          </Button>

          {/* Settings Button - Long Rounded Rectangle */}
          <Button
            variant="outline"
            onPointerDown={() => setIsDrawerOpen(true)}
            className="flex-1 h-12 rounded-full bg-background/80 backdrop-blur-md border shadow-lg transition-transform active:scale-[0.98] active:duration-75 duration-150 ease-out"
          >
            <Settings className="h-5 w-5 mr-2" />
            <span className="text-sm font-medium">Settings</span>
          </Button>

          {/* Next Chapter Button - Circular */}
          <Button
            variant="outline"
            size="icon"
            onPointerDown={onNext}
            disabled={!hasNextChapter}
            aria-label="Next chapter"
            className="h-12 w-12 rounded-full bg-background/80 backdrop-blur-md border shadow-lg disabled:opacity-50 transition-transform active:scale-95 active:duration-75 duration-150 ease-out shrink-0"
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>

      {/* Settings Drawer */}
      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerContent className="">
          <Tabs defaultValue="typography" className="flex-1 flex flex-col mt-2">
            <div className="flex-1 overflow-y-auto px-4 mb-4">
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

            <TabsList className="mx-auto mb-4 w-[85%] h-10 rounded-xl">
              <TabsTrigger value="typography" className="gap-2">
                <Type className="h-4 w-4" />
                Typography
              </TabsTrigger>
              <TabsTrigger value="theme" className="gap-2">
                <Palette className="h-4 w-4" />
                Theme
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </DrawerContent>
      </Drawer>
    </>
  );
}
