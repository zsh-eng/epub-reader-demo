import { Button } from "@/components/ui/button";
import type { ReaderSettings } from "@/types/reader.types";
import { ChevronLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { ReaderControlMenu } from "./ReaderControlMenu";
import {
    ReaderSettingsPanel,
    type ReaderSettingsPanelTab,
} from "./ReaderSettingsSheet";
import {
    type SheetStackRouterDirection,
    useSheetStackRouter,
} from "./hooks/use-sheet-stack-router";
import { ReaderSheet } from "./shared/ReaderSheet";

type ReaderToolsRoute = "root" | "settings";

interface ReaderToolsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

interface ReaderToolsRouteDefinition {
  title: string;
  render: () => ReactNode;
}

const ROUTE_TRANSITION = {
  duration: 0.26,
  ease: [0.16, 1, 0.3, 1] as const,
};

const ROUTE_VARIANTS = {
  enter: (direction: SheetStackRouterDirection) => ({
    opacity: 0,
    x: direction > 0 ? "100%" : "-100%",
  }),
  center: {
    opacity: 1,
    x: "0%",
  },
  exit: (direction: SheetStackRouterDirection) => ({
    opacity: 0,
    x: direction > 0 ? "-24%" : "24%",
  }),
};

/**
 * ReaderToolsSheet keeps the reader utilities inside one persistent drawer and
 * owns the local stack navigation for content rendered inside that shell.
 */
export function ReaderToolsSheet({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}: ReaderToolsSheetProps) {
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<ReaderSettingsPanelTab>("typography");
  const {
    state: toolsRouterState,
    actions: toolsRouterActions,
  } = useSheetStackRouter<ReaderToolsRoute>("root");

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    toolsRouterActions.reset("root", { direction: 1 });
  }, [isOpen, toolsRouterActions]);

  const activeRoute = toolsRouterState.currentRoute;
  const routeDirection = toolsRouterState.direction;
  const canGoBack = toolsRouterState.canGoBack;

  const routeDefinitions: Record<ReaderToolsRoute, ReaderToolsRouteDefinition> = {
    root: {
      title: "Reader Tools",
      render: () => (
        <ReaderControlMenu
          onOpenSettings={() => {
            toolsRouterActions.push("settings");
          }}
        />
      ),
    },
    settings: {
      title: "Reading Settings",
      render: () => (
        <ReaderSettingsPanel
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          activeTab={activeSettingsTab}
          onActiveTabChange={setActiveSettingsTab}
        />
      ),
    },
  };
  const activeDefinition = routeDefinitions[activeRoute];

  return (
    <ReaderSheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={activeDefinition.title}
      panelClassName="max-w-md"
      bodyClassName="overflow-hidden"
      header={
        <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3">
          {canGoBack ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toolsRouterActions.pop}
              aria-label="Go back"
              className="size-8 rounded-full border border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </Button>
          ) : (
            <div className="size-8" aria-hidden="true" />
          )}

          <p className="truncate text-center text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {activeDefinition.title}
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
          {activeDefinition.render()}
        </motion.div>
      </AnimatePresence>
    </ReaderSheet>
  );
}
