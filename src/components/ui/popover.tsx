"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

const PopoverAnchorContext = React.createContext<
  React.RefObject<HTMLElement | null> | undefined
>(undefined);

function Popover({
  children,
  ...props
}: PopoverPrimitive.Root.Props) {
  const anchorRef = React.useRef<HTMLElement | null>(null);

  return (
    <PopoverAnchorContext.Provider value={anchorRef}>
      <PopoverPrimitive.Root data-slot="popover" {...props}>
        {children}
      </PopoverPrimitive.Root>
    </PopoverAnchorContext.Provider>
  );
}

function PopoverTrigger({
  ...props
}: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      {...props}
    />
  );
}

function PopoverContent({
  className,
  align = "center",
  alignOffset,
  sideOffset = 4,
  side,
  onInteractOutside: _onInteractOutside,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    onInteractOutside?: (event: Event) => void;
  }) {
  const anchorRef = React.useContext(PopoverAnchorContext);

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchorRef?.current ? anchorRef : undefined}
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
        className={cn(
          "bg-popover text-popover-foreground data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--transform-origin) rounded-md border p-4 shadow-md outline-hidden",
          className,
        )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({
  children,
  ...props
}: React.ComponentProps<"div">) {
  const anchorRef = React.useContext(PopoverAnchorContext);

  return (
    <div
      data-slot="popover-anchor"
      ref={anchorRef as React.RefObject<HTMLDivElement>}
      {...props}
    >
      {children}
    </div>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
