import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ReaderSettings } from "@/types/reader.types";
import { Columns2, Palette, Type } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ThemePanel } from "../Reader/ReaderSettings/ThemePanel";
import { TypographyPanel } from "../Reader/ReaderSettings/TypographyPanel";

interface ReaderSettingsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  showColumnSelector: boolean;
  spreadColumns: 1 | 2;
  onSpreadColumnsChange: (columns: 1 | 2) => void;
}

export function ReaderSettingsSheet({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  showColumnSelector,
  spreadColumns,
  onSpreadColumnsChange,
}: ReaderSettingsSheetProps) {
  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="settings-backdrop"
            className="fixed inset-0 z-30 bg-foreground/10"
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
            className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl border-t bg-background/95 backdrop-blur-md"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)" }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>

            <Tabs defaultValue="typography" className="flex flex-col">
              <div className="max-h-[55vh] overflow-y-auto px-4 py-2">
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
        )}
      </AnimatePresence>
    </>
  );
}
