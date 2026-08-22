import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type BottomSheetSnapPoint = number | string;

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  header?: ReactNode;
  showHeader?: boolean;
  children: ReactNode;
  contentClassName?: string;
  panelClassName?: string;
  bodyClassName?: string;
  disableBodyDrag?: boolean;
  snapPoints?: readonly BottomSheetSnapPoint[];
  activeSnapPoint?: BottomSheetSnapPoint | null;
  setActiveSnapPoint?: (snapPoint: BottomSheetSnapPoint | null) => void;
}

/**
 * Shared bottom-sheet shell for peer-level application destinations.
 *
 * It owns the rounded material, safe-area behavior, and drag surface so each
 * feature only supplies its header and content hierarchy.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  header,
  showHeader = true,
  children,
  contentClassName,
  panelClassName,
  bodyClassName,
  disableBodyDrag = false,
  snapPoints,
  activeSnapPoint,
  setActiveSnapPoint,
}: BottomSheetProps) {
  const bodyDragProps = disableBodyDrag
    ? { "data-base-ui-swipe-ignore": "" }
    : {};
  // A full-height snap point is clamped to auto-height content by Base UI. Its
  // presence also enables damped upward over-drag and settle-back.
  const resolvedSnapPoints = snapPoints ?? [1];
  const mutableSnapPoints = [...resolvedSnapPoints];
  const snapPointProps = mutableSnapPoints
    ? {
        snapPoints: mutableSnapPoints,
        snapPoint: activeSnapPoint,
        onSnapPointChange: setActiveSnapPoint,
      }
    : {};

  return (
    <Drawer
      direction="bottom"
      open={open}
      onOpenChange={onOpenChange}
      {...snapPointProps}
    >
      <DrawerContent
        overlayClassName="bg-transparent"
        className={cn(
          "border-none bg-transparent shadow-none",
          "data-[drawer-direction=bottom]:mt-12",
          "data-[drawer-direction=bottom]:max-h-[88vh]",
          "[&>div:first-child]:hidden",
          contentClassName,
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-3xl min-h-0 flex-col overflow-hidden",
            "rounded-t-[1.9rem] border border-border/70 bg-background/95",
            "backdrop-blur-xl shadow-[0_-24px_60px_hsl(var(--foreground)/0.08)]",
            panelClassName,
          )}
        >
          <DrawerTitle className="sr-only">{title}</DrawerTitle>

          <div className="flex justify-center pt-3 pb-2">
            <div className="h-1 w-10 rounded-full bg-border/80" />
          </div>

          {showHeader && (
            <div className="px-4">
              {header ?? (
                <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3">
                  <div className="size-8" aria-hidden="true" />
                  <p className="truncate text-center text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {title}
                  </p>
                  <div className="size-8" aria-hidden="true" />
                </div>
              )}
            </div>
          )}

          <div
            className={cn("min-h-0 flex-1", bodyClassName)}
            {...bodyDragProps}
          >
            {children}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
