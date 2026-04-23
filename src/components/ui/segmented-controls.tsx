"use client";

import * as React from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

const SEGMENTED_PILL_TRANSITION = {
  type: "spring" as const,
  stiffness: 420,
  damping: 34,
  mass: 0.8,
};

interface SegmentedControlContextValue {
  activeValue?: string;
  reducedMotion: boolean;
}

const SegmentedTabsContext =
  React.createContext<SegmentedControlContextValue | null>(null);
const SegmentedToggleGroupContext =
  React.createContext<SegmentedControlContextValue | null>(null);

function SegmentedActivePill({
  reducedMotion,
}: {
  reducedMotion: boolean;
}) {
  return (
    <motion.div
      layoutId="segmented-active-pill"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 bg-background/90 shadow-sm ring-1 ring-border/70"
      style={{ borderRadius: "inherit" }}
      initial={false}
      transition={reducedMotion ? { duration: 0 } : SEGMENTED_PILL_TRANSITION}
    />
  );
}

export function SegmentedTabs({
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof Tabs>) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
  const reducedMotion = useReducedMotion() ?? false;
  const activeValue = value ?? uncontrolledValue;
  const layoutGroupId = React.useId();

  return (
    <LayoutGroup id={layoutGroupId}>
      <SegmentedTabsContext.Provider value={{ activeValue, reducedMotion }}>
        <Tabs
          value={activeValue}
          onValueChange={(nextValue) => {
            if (value === undefined) {
              setUncontrolledValue(nextValue);
            }
            onValueChange?.(nextValue);
          }}
          {...props}
        />
      </SegmentedTabsContext.Provider>
    </LayoutGroup>
  );
}

export function SegmentedTabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsList>) {
  return <TabsList className={className} {...props} />;
}

export function SegmentedTabsTrigger({
  className,
  value,
  children,
  ...props
}: React.ComponentProps<typeof TabsTrigger>) {
  const context = React.useContext(SegmentedTabsContext);

  if (!context) {
    throw new Error("SegmentedTabsTrigger must be used inside SegmentedTabs.");
  }

  const isActive = context.activeValue === value;

  return (
    <TabsTrigger
      asChild
      value={value}
      className={cn(
        "relative isolate data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent",
        className,
      )}
      {...props}
    >
      <motion.button>
        {isActive ? (
          <SegmentedActivePill reducedMotion={context.reducedMotion} />
        ) : null}
        <span
          className="relative z-10 inline-flex min-w-0"
          style={{
            width: "100%",
            height: "100%",
            alignItems: "inherit",
            justifyContent: "inherit",
            gap: "inherit",
          }}
        >
          {children}
        </span>
      </motion.button>
    </TabsTrigger>
  );
}

export const SegmentedTabsContent = TabsContent;

type SegmentedToggleGroupProps = Omit<
  React.ComponentProps<typeof ToggleGroup>,
  "type" | "value" | "defaultValue" | "onValueChange"
> & {
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  value?: string;
};

export function SegmentedToggleGroup({
  value,
  defaultValue,
  onValueChange,
  ...props
}: SegmentedToggleGroupProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
  const reducedMotion = useReducedMotion() ?? false;
  const activeValue = value ?? uncontrolledValue;
  const layoutGroupId = React.useId();

  return (
    <LayoutGroup id={layoutGroupId}>
      <SegmentedToggleGroupContext.Provider value={{ activeValue, reducedMotion }}>
        <ToggleGroup
          type="single"
          value={activeValue}
          onValueChange={(nextValue) => {
            if (value === undefined) {
              setUncontrolledValue(nextValue);
            }
            onValueChange?.(nextValue);
          }}
          {...props}
        />
      </SegmentedToggleGroupContext.Provider>
    </LayoutGroup>
  );
}

export function SegmentedToggleGroupItem({
  className,
  value,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupItem>) {
  const context = React.useContext(SegmentedToggleGroupContext);

  if (!context) {
    throw new Error(
      "SegmentedToggleGroupItem must be used inside SegmentedToggleGroup.",
    );
  }

  const isActive = context.activeValue === value;

  return (
    <ToggleGroupItem
      asChild
      value={value}
      className={cn(
        "relative isolate data-[state=on]:bg-transparent data-[state=on]:text-foreground",
        className,
      )}
      {...props}
    >
      <motion.button>
        {isActive ? (
          <SegmentedActivePill reducedMotion={context.reducedMotion} />
        ) : null}
        <span
          className="relative z-10 inline-flex min-w-0"
          style={{
            width: "100%",
            height: "100%",
            alignItems: "inherit",
            justifyContent: "inherit",
            gap: "inherit",
          }}
        >
          {children}
        </span>
      </motion.button>
    </ToggleGroupItem>
  );
}
