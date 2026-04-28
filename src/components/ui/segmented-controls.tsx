"use client";

import * as React from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

const SEGMENTED_PILL_TRANSITION = {
  type: "spring" as const,
  stiffness: 390,
  damping: 36,
  mass: 0.9,
};

interface SegmentedControlContextValue {
  activeValue?: string;
  reducedMotion: boolean;
}

const SegmentedTabsContext =
  React.createContext<SegmentedControlContextValue | null>(null);
const SegmentedToggleGroupContext =
  React.createContext<SegmentedControlContextValue | null>(null);

function SegmentedActivePill({ reducedMotion }: { reducedMotion: boolean }) {
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
  const [uncontrolledValue, setUncontrolledValue] =
    React.useState(defaultValue);
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
            (onValueChange as ((value: string) => void) | undefined)?.(
              nextValue as string,
            );
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
  return <TabsList className={cn("overflow-hidden", className)} {...props} />;
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
      render={
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
      }
      value={value}
      className={cn(
        "relative isolate data-[active]:border-transparent data-[active]:bg-transparent data-[active]:shadow-none dark:data-[active]:border-transparent dark:data-[active]:bg-transparent",
        className,
      )}
      {...props}
    />
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
  className,
  ...props
}: SegmentedToggleGroupProps) {
  const [uncontrolledValue, setUncontrolledValue] =
    React.useState(defaultValue);
  const reducedMotion = useReducedMotion() ?? false;
  const activeValue = value ?? uncontrolledValue;
  const layoutGroupId = React.useId();

  return (
    <LayoutGroup id={layoutGroupId}>
      <SegmentedToggleGroupContext.Provider
        value={{ activeValue, reducedMotion }}
      >
        <ToggleGroup
          type="single"
          value={activeValue}
          onValueChange={(nextValue) => {
            const nextStringValue = Array.isArray(nextValue)
              ? (nextValue[0] ?? "")
              : nextValue;
            if (value === undefined) {
              setUncontrolledValue(nextStringValue);
            }
            onValueChange?.(nextStringValue);
          }}
          className={cn("overflow-hidden", className)}
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
      render={
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
      }
      value={value}
      className={cn(
        "relative isolate first:rounded-l-[inherit] last:rounded-r-[inherit] data-[pressed]:bg-transparent data-[pressed]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
