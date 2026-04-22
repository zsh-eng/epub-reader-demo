import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface ReaderSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  header?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  panelClassName?: string;
  bodyClassName?: string;
  disableBodyDrag?: boolean;
}

/**
 * Reader-specific bottom sheet shell.
 *
 * This wraps the shared Drawer primitive so reader overlays share the same
 * rounded chrome, safe-area handling, and drag behavior without each feature
 * re-implementing the same structure.
 */
export function ReaderSheet({
  open,
  onOpenChange,
  title,
  header,
  children,
  contentClassName,
  panelClassName,
  bodyClassName,
  disableBodyDrag = false,
}: ReaderSheetProps) {
  const bodyDragProps = disableBodyDrag ? { "data-vaul-no-drag": "" } : {};

  return (
    <Drawer direction="bottom" open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className={cn(
          "border-none bg-transparent shadow-none",
          "data-[vaul-drawer-direction=bottom]:mt-12",
          "data-[vaul-drawer-direction=bottom]:max-h-[88vh]",
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
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)",
          }}
        >
          <DrawerTitle className="sr-only">{title}</DrawerTitle>

          <div className="flex justify-center pt-3 pb-2">
            <div className="h-1 w-10 rounded-full bg-border/80" />
          </div>

          <div className="px-4 pb-3">
            {header ?? (
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {title}
              </p>
            )}
          </div>

          <div className={cn("min-h-0 flex-1", bodyClassName)} {...bodyDragProps}>
            {children}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
