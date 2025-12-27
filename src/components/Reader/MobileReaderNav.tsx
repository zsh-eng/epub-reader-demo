import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TOCItem } from "@/lib/db";
import { cn } from "@/lib/utils";
import type { ReaderSettings } from "@/types/reader.types";
import {
  ChevronLeft,
  ChevronRight,
  List,
  Palette,
  Settings,
  Type,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  toc: TOCItem[];
  currentChapterHref: string;
  onNavigateToChapter: (href: string) => void;
}

// Flatten nested TOC structure into a linear list
function flattenTOC(items: TOCItem[]): TOCItem[] {
  const result: TOCItem[] = [];

  function traverse(items: TOCItem[]) {
    for (const item of items) {
      result.push(item);
      if (item.children && item.children.length > 0) {
        traverse(item.children);
      }
    }
  }

  traverse(items);
  return result;
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
  toc,
  currentChapterHref,
  onNavigateToChapter,
}: MobileReaderNavProps) {
  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState(false);
  const [isTOCDrawerOpen, setIsTOCDrawerOpen] = useState(false);
  const currentItemRef = useRef<HTMLButtonElement>(null);

  const flatTOC = flattenTOC(toc);

  // Auto-scroll to current chapter when TOC drawer opens
  useEffect(() => {
    if (isTOCDrawerOpen) {
      // Small delay to ensure drawer is fully rendered
      setTimeout(() => {
        currentItemRef.current?.scrollIntoView({
          block: "center",
          behavior: "instant",
        });
      }, 100);
    }
  }, [isTOCDrawerOpen]);

  const handleTOCNavigate = (href: string) => {
    onNavigateToChapter(href);
    setIsTOCDrawerOpen(false);
  };

  // Normalize href for comparison (remove leading slashes and fragments)
  const normalizeHref = (href: string) => {
    return href.split("#")[0].replace(/^\/+/, "");
  };

  const currentNormalizedHref = normalizeHref(currentChapterHref);

  return (
    <>
      {/* Top Right Buttons - X and Settings */}
      <div className="fixed right-4 top-4 z-40 flex flex-col gap-2">
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
        <Button
          variant="ghost"
          size="icon"
          onPointerDown={() => setIsSettingsDrawerOpen(true)}
          aria-label="Settings"
          className={cn(
            "h-10 w-10 rounded-full bg-background/80 backdrop-blur-md border shadow-lg transition-[transform,opacity] active:scale-95 active:duration-75 duration-150 ease-out",
            isVisible ? "opacity-100" : "opacity-0",
          )}
        >
          <Settings className="size-4" />
        </Button>
      </div>

      {/* Bottom Navigation Bar */}
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 px-4 pt-2 transition-transform duration-300 ease-out",
          isVisible || isSettingsDrawerOpen || isTOCDrawerOpen
            ? "translate-y-0"
            : "translate-y-full",
        )}
        style={{
          paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
        }}
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

          {/* Table of Contents Button - Long Rounded Rectangle */}
          <Button
            variant="outline"
            onPointerDown={() => setIsTOCDrawerOpen(true)}
            className="flex-1 h-12 rounded-full bg-background/80 backdrop-blur-md border shadow-lg transition-transform active:scale-[0.98] active:duration-75 duration-150 ease-out"
          >
            <List className="h-5 w-5 mr-2" />
            <span className="text-sm font-medium">Table of Contents</span>
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
      <Drawer
        open={isSettingsDrawerOpen}
        onOpenChange={setIsSettingsDrawerOpen}
      >
        <DrawerContent
          className="pb-4"
          style={{
            paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
          }}
        >
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

            <TabsList className="mx-auto mb-4 w-[85%] h-10">
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

      {/* Table of Contents Drawer */}
      <Drawer open={isTOCDrawerOpen} onOpenChange={setIsTOCDrawerOpen}>
        <DrawerContent
          className="pb-4"
          style={{
            paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
          }}
        >
          <div className="overflow-y-auto px-4 max-h-[60vh]">
            {flatTOC && flatTOC.length > 0 ? (
              <div className="space-y-1">
                {flatTOC.map((item, index) => {
                  const itemNormalizedHref = normalizeHref(item.href);
                  const isCurrentChapter =
                    itemNormalizedHref === currentNormalizedHref;

                  return (
                    <button
                      key={index}
                      ref={isCurrentChapter ? currentItemRef : null}
                      onClick={() => handleTOCNavigate(item.href)}
                      className={cn(
                        "w-full text-left px-4 py-3 rounded-lg transition-colors text-sm",
                        isCurrentChapter
                          ? "bg-primary text-primary-foreground font-medium"
                          : "hover:bg-accent",
                      )}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground px-4 py-3">
                No table of contents available
              </p>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
