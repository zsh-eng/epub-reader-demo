"use client";

import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ============================================================================
// Context
// ============================================================================

interface LongPressMenuContextValue {
  isOpen: boolean;
  isPressing: boolean;
  open: () => void;
  close: () => void;
  triggerRect: DOMRect | null;
  setTriggerRect: (rect: DOMRect | null) => void;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
  setIsPressing: (pressing: boolean) => void;
}

const LongPressMenuContext = createContext<LongPressMenuContextValue | null>(
  null,
);

function useLongPressMenu() {
  const context = useContext(LongPressMenuContext);
  if (!context) {
    throw new Error(
      "LongPressMenu components must be used within a LongPressMenu",
    );
  }
  return context;
}

// ============================================================================
// Root
// ============================================================================

interface LongPressMenuProps {
  children: React.ReactNode;
  /** Duration in ms before long-press triggers. Default: 300ms */
  pressDelay?: number;
  /** Whether to trigger haptic feedback. Default: true */
  hapticFeedback?: boolean;
}

function LongPressMenu({
  children,
  pressDelay = 300,
  hapticFeedback = true,
}: LongPressMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const open = React.useCallback(() => {
    if (hapticFeedback && navigator.vibrate) {
      navigator.vibrate(10);
    }
    setIsOpen(true);
    setIsPressing(false); // No longer pressing once menu opens
  }, [hapticFeedback]);

  const close = React.useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <LongPressMenuContext.Provider
      value={{
        isOpen,
        isPressing,
        open,
        close,
        triggerRect,
        setTriggerRect,
        triggerRef,
        setIsPressing,
      }}
    >
      <LongPressMenuInner pressDelay={pressDelay}>
        {children}
      </LongPressMenuInner>
    </LongPressMenuContext.Provider>
  );
}

// Internal component that has access to context
function LongPressMenuInner({
  children,
  pressDelay,
}: {
  children: React.ReactNode;
  pressDelay: number;
}) {
  const { isOpen, open, close, setTriggerRect, triggerRef, setIsPressing } =
    useLongPressMenu();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPressingRef = useRef(false);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  const handlePressStart = (
    e: React.TouchEvent | React.MouseEvent,
    element: HTMLElement,
  ) => {
    // Only handle touch events on touch devices, mouse for desktop
    if ("touches" in e && e.touches.length > 1) return;

    isPressingRef.current = true;
    triggerRef.current = element;
    setIsPressing(true); // Start visual feedback

    timerRef.current = setTimeout(() => {
      if (isPressingRef.current && triggerRef.current) {
        // Smooth scroll the element into view
        triggerRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });

        // Get rect and open menu immediately
        const rect = triggerRef.current.getBoundingClientRect();
        setTriggerRect(rect);
        open();
      }
    }, pressDelay);
  };

  const handlePressEnd = () => {
    isPressingRef.current = false;
    setIsPressing(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handlePressCancel = () => {
    isPressingRef.current = false;
    setIsPressing(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Clone children and pass down handlers
  const childrenWithHandlers = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      // Check if this is a LongPressMenuTrigger
      if (
        (child.type as React.ComponentType)?.displayName ===
        "LongPressMenuTrigger"
      ) {
        return React.cloneElement(
          child as React.ReactElement<LongPressMenuTriggerProps>,
          {
            onPressStart: handlePressStart,
            onPressEnd: handlePressEnd,
            onPressCancel: handlePressCancel,
          },
        );
      }
    }
    return child;
  });

  return <>{childrenWithHandlers}</>;
}

// ============================================================================
// Trigger
// ============================================================================

interface LongPressMenuTriggerProps {
  children: React.ReactNode;
  className?: string;
  asChild?: boolean;
  // Internal props passed by LongPressMenuInner
  onPressStart?: (
    e: React.TouchEvent | React.MouseEvent,
    element: HTMLElement,
  ) => void;
  onPressEnd?: () => void;
  onPressCancel?: () => void;
}

function LongPressMenuTrigger({
  children,
  className,
  onPressStart,
  onPressEnd,
  onPressCancel,
}: LongPressMenuTriggerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { isOpen, isPressing } = useLongPressMenu();

  const handleTouchStart = (e: React.TouchEvent) => {
    if (ref.current && onPressStart) {
      onPressStart(e, ref.current);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only handle left click
    if (e.button !== 0) return;
    if (ref.current && onPressStart) {
      onPressStart(e, ref.current);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    // Prevent default context menu on long-press
    e.preventDefault();
  };

  // Determine transform based on state
  const getTransform = () => {
    if (isOpen) return "scale(1.05)";
    if (isPressing) return "scale(0.97)";
    return undefined;
  };

  return (
    <div
      ref={ref}
      className={cn(
        "touch-none select-none transition-transform duration-200",
        className,
      )}
      style={{
        // Disable iOS long-press callout menu
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        // When open, lift the element with z-index and scale
        position: isOpen ? "relative" : undefined,
        zIndex: isOpen ? 60 : undefined,
        transform: getTransform(),
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={onPressEnd}
      onTouchCancel={onPressCancel}
      onMouseDown={handleMouseDown}
      onMouseUp={onPressEnd}
      onMouseLeave={onPressCancel}
      onContextMenu={handleContextMenu}
    >
      {children}
    </div>
  );
}
LongPressMenuTrigger.displayName = "LongPressMenuTrigger";

// ============================================================================
// Content (Overlay via portal + Menu rendered relative to trigger)
// ============================================================================

interface LongPressMenuContentProps {
  children: React.ReactNode;
  className?: string;
}

function LongPressMenuContent({
  children,
  className,
}: LongPressMenuContentProps) {
  const { isOpen, close, triggerRef } = useLongPressMenu();
  const [placement, setPlacement] = useState<"above" | "below">("below");

  // Determine placement based on trigger position in viewport
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const menuHeight = 200; // Approximate
    const gap = 12;

    const spaceBelow = viewportHeight - rect.bottom;
    setPlacement(spaceBelow >= menuHeight + gap ? "below" : "above");
  }, [isOpen, triggerRef]);

  if (typeof document === "undefined") return null;

  // Backdrop is portaled to cover everything
  const backdrop = createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={close}
        />
      )}
    </AnimatePresence>,
    document.body,
  );

  // Menu is rendered relative to the trigger (not portaled)
  // This means it scrolls with the trigger naturally
  return (
    <>
      {backdrop}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: placement === "below" ? -8 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: placement === "below" ? -8 : 8 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "absolute z-[70] left-1/2 -translate-x-1/2",
              placement === "below" ? "top-full mt-3" : "bottom-full mb-3",
              className,
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ============================================================================
// Item
// ============================================================================

interface LongPressMenuItemProps {
  children: React.ReactNode;
  className?: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

function LongPressMenuItem({
  children,
  className,
  destructive,
  disabled,
  onClick,
}: LongPressMenuItemProps) {
  const { close } = useLongPressMenu();

  const handleClick = () => {
    onClick?.();
    close();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition-colors",
        "bg-popover hover:bg-accent active:bg-accent",
        destructive && "text-destructive hover:text-destructive",
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}

// ============================================================================
// Items Container
// ============================================================================

interface LongPressMenuItemsProps {
  children: React.ReactNode;
  className?: string;
}

function LongPressMenuItems({ children, className }: LongPressMenuItemsProps) {
  return (
    <div
      className={cn(
        "w-[220px] overflow-hidden rounded-xl bg-popover p-1 shadow-lg ring-1 ring-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ============================================================================
// Separator
// ============================================================================

function LongPressMenuSeparator({ className }: { className?: string }) {
  return <div className={cn("my-1 h-px bg-border", className)} />;
}

// ============================================================================
// Exports
// ============================================================================

export {
  LongPressMenu,
  LongPressMenuContent,
  LongPressMenuItem,
  LongPressMenuItems,
  LongPressMenuSeparator,
  LongPressMenuTrigger,
};
