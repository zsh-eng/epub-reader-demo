"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";

import { cn } from "@/lib/utils";

type DrawerDirection = "top" | "right" | "bottom" | "left";

const DrawerDirectionContext = React.createContext<DrawerDirection>("bottom");

function toSwipeDirection(direction: DrawerDirection) {
  if (direction === "top") return "up";
  if (direction === "right") return "right";
  if (direction === "left") return "left";
  return "down";
}

function Drawer({
  direction = "bottom",
  children,
  ...props
}: DrawerPrimitive.Root.Props & { direction?: DrawerDirection }) {
  return (
    <DrawerDirectionContext.Provider value={direction}>
      <DrawerPrimitive.Root
        data-slot="drawer"
        swipeDirection={toSwipeDirection(direction)}
        {...props}
      >
        {children}
      </DrawerPrimitive.Root>
    </DrawerDirectionContext.Provider>
  );
}

function DrawerNestedRoot({
  direction = "bottom",
  children,
  ...props
}: DrawerPrimitive.Root.Props & { direction?: DrawerDirection }) {
  return (
    <DrawerDirectionContext.Provider value={direction}>
      <DrawerPrimitive.Root
        data-slot="drawer-nested-root"
        swipeDirection={toSwipeDirection(direction)}
        {...props}
      >
        {children}
      </DrawerPrimitive.Root>
    </DrawerDirectionContext.Provider>
  );
}

function DrawerTrigger({
  ...props
}: DrawerPrimitive.Trigger.Props) {
  return (
    <DrawerPrimitive.Trigger
      data-slot="drawer-trigger"
      {...props}
    />
  );
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        "data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 fixed inset-0 z-50",
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  overlayClassName,
  children,
  ...props
}: DrawerPrimitive.Popup.Props & {
  overlayClassName?: string;
}) {
  const direction = React.useContext(DrawerDirectionContext);

  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay className={overlayClassName ?? "bg-black/50"} />
      <DrawerPrimitive.Viewport>
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          data-drawer-direction={direction}
          className={cn(
            "group/drawer-content bg-background fixed z-50 flex h-auto flex-col",
            "data-[drawer-direction=top]:inset-x-0 data-[drawer-direction=top]:top-0 data-[drawer-direction=top]:mb-24 data-[drawer-direction=top]:max-h-[80vh] data-[drawer-direction=top]:rounded-b-lg data-[drawer-direction=top]:border-b",
            "data-[drawer-direction=bottom]:inset-x-0 data-[drawer-direction=bottom]:bottom-0 data-[drawer-direction=bottom]:mt-24 data-[drawer-direction=bottom]:max-h-[80vh] data-[drawer-direction=bottom]:rounded-t-lg data-[drawer-direction=bottom]:border-t",
            "data-[drawer-direction=right]:inset-y-0 data-[drawer-direction=right]:right-0 data-[drawer-direction=right]:w-3/4 data-[drawer-direction=right]:border-l data-[drawer-direction=right]:sm:max-w-sm",
            "data-[drawer-direction=left]:inset-y-0 data-[drawer-direction=left]:left-0 data-[drawer-direction=left]:w-3/4 data-[drawer-direction=left]:border-r data-[drawer-direction=left]:sm:max-w-sm",
            className,
          )}
          {...props}
        >
          <div className="bg-muted mx-auto mt-4 hidden h-2 w-[100px] shrink-0 rounded-full group-data-[drawer-direction=bottom]/drawer-content:block" />
          {children}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[drawer-direction=bottom]/drawer-content:text-center group-data-[drawer-direction=top]/drawer-content:text-center md:gap-1.5 md:text-left",
        className,
      )}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function DrawerTitle({
  className,
  ...props
}: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerNestedRoot,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
