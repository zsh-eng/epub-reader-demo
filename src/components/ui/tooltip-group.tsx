"use client";

import { cn } from "@/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

interface TooltipGroupContextValue {
  isAnyOpen: boolean;
  setTooltipOpen: (id: string, open: boolean) => void;
  delayDuration: number;
}

const TooltipGroupContext =
  React.createContext<TooltipGroupContextValue | null>(null);

function useTooltipGroup() {
  const context = React.useContext(TooltipGroupContext);
  if (!context) {
    throw new Error("useTooltipGroup must be used within a TooltipGroup");
  }
  return context;
}

interface TooltipGroupProps {
  children: React.ReactNode;
  delayDuration?: number;
  skipDelayDuration?: number;
}

/**
 * TooltipGroup Component
 *
 * Provides grouped tooltip behavior where:
 * - First tooltip has a delay before showing
 * - Once any tooltip is open, hovering other tooltips shows them instantly
 * - Small delay before reverting to normal behavior after all tooltips close
 */
function TooltipGroup({
  children,
  delayDuration = 500,
  skipDelayDuration = 300,
}: TooltipGroupProps) {
  const skipDelayTimerRef = React.useRef<number | null>(null);
  const [isInSkipDelayMode, setIsInSkipDelayMode] = React.useState(false);

  const setTooltipOpen = React.useCallback(
    (_id: string, open: boolean) => {
      // Clear any existing skip delay timer
      if (skipDelayTimerRef.current !== null) {
        window.clearTimeout(skipDelayTimerRef.current);
        skipDelayTimerRef.current = null;
      }

      if (open) {
        // When opening a tooltip, enter skip delay mode
        setIsInSkipDelayMode(true);
      } else {
        // When closing a tooltip, wait a bit before exiting skip delay mode
        // This allows smooth transitions between tooltips
        skipDelayTimerRef.current = window.setTimeout(() => {
          setIsInSkipDelayMode(false);
        }, skipDelayDuration);
      }
    },
    [skipDelayDuration],
  );

  React.useEffect(() => {
    return () => {
      if (skipDelayTimerRef.current !== null) {
        window.clearTimeout(skipDelayTimerRef.current);
      }
    };
  }, []);

  const contextValue = React.useMemo(
    () => ({
      isAnyOpen: isInSkipDelayMode,
      setTooltipOpen,
      delayDuration,
    }),
    [isInSkipDelayMode, setTooltipOpen, delayDuration],
  );

  return (
    <TooltipGroupContext.Provider value={contextValue}>
      <TooltipPrimitive.Provider
        delayDuration={0}
        skipDelayDuration={skipDelayDuration}
      >
        {children}
      </TooltipPrimitive.Provider>
    </TooltipGroupContext.Provider>
  );
}

interface GroupedTooltipProps {
  id: string;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * GroupedTooltip Component
 *
 * A tooltip that participates in a TooltipGroup.
 * Must be used within a TooltipGroup component.
 */
function GroupedTooltip({
  id,
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: GroupedTooltipProps) {
  const { isAnyOpen, setTooltipOpen, delayDuration } = useTooltipGroup();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      setTooltipOpen(id, open);
      if (isControlled) {
        controlledOnOpenChange?.(open);
      } else {
        setUncontrolledOpen(open);
      }
    },
    [id, setTooltipOpen, isControlled, controlledOnOpenChange],
  );

  return (
    <TooltipPrimitive.Root
      open={isOpen}
      onOpenChange={handleOpenChange}
      delayDuration={isAnyOpen ? 0 : delayDuration}
    >
      {children}
    </TooltipPrimitive.Root>
  );
}

function GroupedTooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function GroupedTooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export {
  GroupedTooltip,
  GroupedTooltipContent,
  GroupedTooltipTrigger,
  TooltipGroup,
  useTooltipGroup,
};
