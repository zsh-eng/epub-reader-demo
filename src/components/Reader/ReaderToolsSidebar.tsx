import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { TOCItem } from "@/lib/db";
import { cn } from "@/lib/utils";
import type { ReaderSettings } from "@/types/reader.types";
import {
  ChevronRight,
  ClipboardCopy,
  List,
  Search,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { ReaderContentsPanel } from "./ReaderContentsSheet";
import {
  ReaderSettingsPanel,
  type ReaderSettingsPanelTab,
} from "./ReaderSettingsSheet";
import type { ChapterEntry, ReaderSheetId } from "./types";

type ReaderSidebarPanel = "contents" | "search" | "settings";

interface ReaderToolsSidebarProps {
  activeSheet: ReaderSheetId | null;
  onOpenPanel: (panel: ReaderSidebarPanel) => void;
  onClose: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  toc: TOCItem[];
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentChapterHref: string;
  onNavigateToHref: (href: string) => boolean;
  onCopyDebugDump?: () => void;
}

const SIDEBAR_TOOLS: {
  id: ReaderSidebarPanel;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "contents", label: "Contents", icon: List },
  { id: "search", label: "Search book", icon: Search },
  { id: "settings", label: "Reading appearance", icon: SlidersHorizontal },
];

function resolveActivePanel(
  activeSheet: ReaderSheetId | null,
): ReaderSidebarPanel {
  if (activeSheet === "search") return "search";
  if (activeSheet === "settings") return "settings";
  return "contents";
}

/**
 * Desktop reader workspace anchored to the book's right edge.
 *
 * Frequent tools switch within one persistent surface. This keeps the book in
 * view and avoids a stack of launcher and destination sheets.
 */
export function ReaderToolsSidebar({
  activeSheet,
  onOpenPanel,
  onClose,
  settings,
  onUpdateSettings,
  toc,
  chapterEntries,
  chapterStartPages,
  currentChapterHref,
  onNavigateToHref,
  onCopyDebugDump,
}: ReaderToolsSidebarProps) {
  const [settingsTab, setSettingsTab] =
    useState<ReaderSettingsPanelTab>("type");
  const activePanel = resolveActivePanel(activeSheet);
  const isOpen = activeSheet !== null;

  return (
    <Drawer
      direction="right"
      open={isOpen}
      onOpenChange={(open) => {
        if (open) return;
        onClose();
      }}
    >
      <DrawerContent
        overlayClassName="bg-transparent"
        className={cn(
          "h-dvh! min-w-[20rem] w-[min(42vw,25rem)]! max-w-none! overflow-hidden p-0",
          "select-none border-l border-border/70 bg-background/95 text-foreground shadow-[-24px_0_64px_hsl(var(--foreground)/0.12)] backdrop-blur-2xl",
          "[-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [-webkit-user-select:none]",
          "motion-reduce:transition-none [&>div:first-child]:hidden",
        )}
      >
        <DrawerTitle className="sr-only">Reader tools</DrawerTitle>
        <DrawerDescription className="sr-only">
          Browse the book and adjust its reading appearance.
        </DrawerDescription>

        <div className="flex h-full min-h-0 flex-col">
          <nav
            aria-label="Reader tools"
            className="relative z-10 flex min-h-14 shrink-0 items-center gap-1.5 px-2 pb-2"
            style={{ paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close reader tools"
              className="size-10 shrink-0 rounded-xl text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95"
            >
              <ChevronRight className="size-[1.15rem]" />
            </Button>

            {SIDEBAR_TOOLS.map((tool) => {
              const isActive = activePanel === tool.id;

              return (
                <Button
                  key={tool.id}
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onOpenPanel(tool.id)}
                  aria-label={tool.label}
                  aria-pressed={isActive}
                  title={tool.label}
                  className={cn(
                    "size-10 shrink-0 rounded-xl text-muted-foreground transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95",
                    isActive && "bg-secondary/70 text-foreground shadow-sm",
                  )}
                >
                  <tool.icon className="size-[1.15rem]" />
                </Button>
              );
            })}

            <div className="min-w-0 flex-1" />

            {onCopyDebugDump && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onCopyDebugDump}
                aria-label="Copy debug dump"
                title="Copy debug dump"
                className="size-10 shrink-0 rounded-xl text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95"
              >
                <ClipboardCopy className="size-[1.1rem]" />
              </Button>
            )}

            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-background/80 to-transparent"
            />
          </nav>

          <div className="min-h-0 flex-1 overflow-hidden">
            {activePanel === "contents" && (
              <ReaderContentsPanel
                isOpen={isOpen}
                toc={toc}
                chapterEntries={chapterEntries}
                chapterStartPages={chapterStartPages}
                currentChapterHref={currentChapterHref}
                onNavigateToHref={onNavigateToHref}
                className="h-full"
              />
            )}

            {activePanel === "search" && (
              <div className="flex h-full flex-col items-center justify-center px-8 pb-[env(safe-area-inset-bottom)] text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-secondary/45 text-muted-foreground">
                  <Search className="size-5" />
                </div>
                <p className="mt-4 text-sm font-medium text-foreground">
                  Search is coming soon
                </p>
                <p className="mt-1 max-w-56 text-sm leading-relaxed text-muted-foreground">
                  Full-book search needs a text index before it can return
                  accurate results.
                </p>
              </div>
            )}

            {activePanel === "settings" && (
              <ReaderSettingsPanel
                settings={settings}
                onUpdateSettings={onUpdateSettings}
                activeTab={settingsTab}
                onActiveTabChange={setSettingsTab}
                className="mt-0 h-full pb-[env(safe-area-inset-bottom)]"
              />
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
