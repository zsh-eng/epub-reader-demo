import { Button } from "@/components/ui/button";
import type { ReaderSettings } from "@/types/reader.types";
import { ChevronLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import {
  type ReaderToolsRoute,
  type ReaderToolsRouteDirection,
} from "./hooks/use-reader-chrome-state";
import { ReaderControlMenu } from "./ReaderControlMenu";
import {
  ReaderSettingsPanel,
  type ReaderSettingsPanelTab,
} from "./ReaderSettingsSheet";
import { ReaderSheet } from "./shared/ReaderSheet";

interface ReaderToolsSheetProps {
  isOpen: boolean;
  activeRoute: ReaderToolsRoute;
  routeDirection: ReaderToolsRouteDirection;
  onClose: () => void;
  onBack: () => void;
  onOpenSettings: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

const ROUTE_TRANSITION = {
  duration: 0.26,
  ease: [0.16, 1, 0.3, 1] as const,
};

const ROUTE_VARIANTS = {
  enter: (direction: ReaderToolsRouteDirection) => ({
    opacity: 0,
    x: direction > 0 ? "100%" : "-100%",
  }),
  center: {
    opacity: 1,
    x: "0%",
  },
  exit: (direction: ReaderToolsRouteDirection) => ({
    opacity: 0,
    x: direction > 0 ? "-24%" : "24%",
  }),
};

/**
 * ReaderToolsSheet keeps the reader utilities inside one persistent drawer and
 * animates route changes within that shell so nested tools feel connected.
 */
export function ReaderToolsSheet({
  isOpen,
  activeRoute,
  routeDirection,
  onClose,
  onBack,
  onOpenSettings,
  settings,
  onUpdateSettings,
}: ReaderToolsSheetProps) {
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<ReaderSettingsPanelTab>("typography");

  const title =
    activeRoute === "settings" ? "Reading Settings" : "Reader Tools";
  const showBackButton = activeRoute !== "root";

  return (
    <ReaderSheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      panelClassName="max-w-md"
      bodyClassName="overflow-hidden"
      header={
        <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3">
          {showBackButton ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onBack}
              aria-label="Back to reader tools"
              className="size-8 rounded-full border border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </Button>
          ) : (
            <div className="size-8" aria-hidden="true" />
          )}

          <p className="truncate text-center text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {title}
          </p>

          <div className="size-8" aria-hidden="true" />
        </div>
      }
    >
      <AnimatePresence initial={false} mode="wait" custom={routeDirection}>
        <motion.div
          key={activeRoute}
          custom={routeDirection}
          variants={ROUTE_VARIANTS}
          initial="enter"
          animate="center"
          exit="exit"
          transition={ROUTE_TRANSITION}
          className="min-h-0"
        >
          {activeRoute === "settings" ? (
            <ReaderSettingsPanel
              settings={settings}
              onUpdateSettings={onUpdateSettings}
              activeTab={activeSettingsTab}
              onActiveTabChange={setActiveSettingsTab}
            />
          ) : (
            <ReaderControlMenu onOpenSettings={onOpenSettings} />
          )}
        </motion.div>
      </AnimatePresence>
    </ReaderSheet>
  );
}
