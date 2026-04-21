import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ReaderSettings } from "@/types/reader.types";
import { Palette, Type } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ThemePanel } from "@/components/ReaderShared/ReaderSettings/ThemePanel";
import { TypographyPanel } from "@/components/ReaderShared/ReaderSettings/TypographyPanel";

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
  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="settings-backdrop"
            className="fixed inset-0 z-30 bg-foreground/10 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="settings-sheet"
            className="fixed inset-x-0 bottom-0 z-30 px-2 sm:px-4"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <div
              className="mx-auto flex max-w-3xl flex-col overflow-hidden rounded-t-[1.9rem] border border-border/70 bg-background/95 backdrop-blur-xl"
              style={{
                paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)",
              }}
            >
              <div className="flex justify-center pt-3 pb-2">
                <div className="h-1 w-10 rounded-full bg-border/80" />
              </div>

              <div className="px-4 pb-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Reading Settings
                </p>
              </div>

              <Tabs defaultValue="typography" className="flex min-h-0 flex-col">
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

                <div className="max-h-[min(65vh,38rem)] overflow-y-auto px-4 pb-3">
                  <TabsContent value="typography" className="mt-0">
                    <TypographyPanel
                      settings={settings}
                      onUpdateSettings={onUpdateSettings}
                      showContentWidthControl={false}
                    />
                  </TabsContent>
                  <TabsContent value="theme" className="mt-0">
                    <ThemePanel
                      settings={settings}
                      onUpdateSettings={onUpdateSettings}
                    />
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
