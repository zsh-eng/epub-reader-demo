"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

// ============================================================================
// Inject styles once (self-contained CSS for popover + anchor positioning)
// ============================================================================

const STYLES_ID = "long-press-menu-styles";

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLES_ID)) return;

  const style = document.createElement("style");
  style.id = STYLES_ID;
  style.textContent = `
    /* Popover base - reset browser defaults */
    .long-press-popover {
      border: none;
      padding: 0;
      background: transparent;
      margin: 0;
      overflow: visible;

      /* Entry animation */
      opacity: 1;
      transform: translateY(0) scale(1);
      transition:
        opacity 0.2s ease-out,
        transform 0.2s ease-out,
        overlay 0.2s ease-out allow-discrete,
        display 0.2s ease-out allow-discrete;
    }

    /* Starting state for entry animation */
    @starting-style {
      .long-press-popover:popover-open {
        opacity: 0;
        transform: translateY(-8px) scale(0.96);
      }
    }

    /* Exit animation - when popover is closing */
    .long-press-popover:not(:popover-open) {
      opacity: 0;
      transform: translateY(-8px) scale(0.96);
    }

    /* Trigger animations */
    .long-press-trigger {
      touch-action: none;
      user-select: none;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
    }

    .long-press-trigger[data-pressing="true"] {
      transform: scale(0.97);
    }

    .long-press-trigger[data-open="true"] {
      position: relative;
      z-index: 60;
      transform: scale(1.03);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    }

    /* Backdrop styling */
    .long-press-backdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      animation: long-press-fade-in 0.2s ease-out;
    }

    @keyframes long-press-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

// ============================================================================
// Context
// ============================================================================

interface LongPressMenuContextValue {
  isOpen: boolean;
  isPressing: boolean;
  open: () => void;
  close: () => void;
  anchorName: string;
  setIsPressing: (pressing: boolean) => void;
  popoverRef: React.RefObject<HTMLDivElement | null>;
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

// Generate unique anchor name for each menu instance
let anchorCounter = 0;
function generateAnchorName() {
  return `--long-press-menu-anchor-${++anchorCounter}`;
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
  const anchorNameRef = useRef<string>(generateAnchorName());
  const popoverRef = useRef<HTMLDivElement>(null);

  // Inject styles on mount
  useEffect(() => {
    injectStyles();
  }, []);

  const open = React.useCallback(() => {
    if (hapticFeedback && navigator.vibrate) {
      navigator.vibrate(10);
    }
    setIsOpen(true);
    setIsPressing(false);
    // Show the popover
    popoverRef.current?.showPopover();
  }, [hapticFeedback]);

  const close = React.useCallback(() => {
    setIsOpen(false);
    popoverRef.current?.hidePopover();
  }, []);

  // Handle escape key (popover="manual" doesn't auto-dismiss)
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

  return (
    <LongPressMenuContext.Provider
      value={{
        isOpen,
        isPressing,
        open,
        close,
        anchorName: anchorNameRef.current,
        setIsPressing,
        popoverRef,
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
  const { open, setIsPressing } = useLongPressMenu();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPressingRef = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handlePressStart = (
    e: React.TouchEvent | React.MouseEvent,
    element: HTMLElement,
  ) => {
    // Only handle touch events on touch devices, mouse for desktop
    if ("touches" in e && e.touches.length > 1) return;

    isPressingRef.current = true;
    triggerRef.current = element;
    setIsPressing(true);

    timerRef.current = setTimeout(() => {
      if (isPressingRef.current && triggerRef.current) {
        // triggerRef.current.scrollIntoView({
        //   behavior: "smooth",
        //   block: "center",
        // });
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
    // NOTE: Do NOT close the menu here - menu stays open until backdrop click or escape
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
  const { isOpen, isPressing, anchorName } = useLongPressMenu();

  const handleTouchStart = (e: React.TouchEvent) => {
    if (ref.current && onPressStart) {
      onPressStart(e, ref.current);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (ref.current && onPressStart) {
      onPressStart(e, ref.current);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className={cn("long-press-trigger", className)}
      data-pressing={isPressing}
      data-open={isOpen}
      style={
        {
          anchorName: anchorName,
        } as React.CSSProperties
      }
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
// Content (uses native popover + CSS anchor positioning + manual backdrop)
// ============================================================================

interface LongPressMenuContentProps {
  children: React.ReactNode;
  className?: string;
}

function LongPressMenuContent({
  children,
  className,
}: LongPressMenuContentProps) {
  const { isOpen, close, anchorName, popoverRef } = useLongPressMenu();

  return (
    <>
      {/* Manual backdrop since popover="manual" doesn't support ::backdrop */}
      {isOpen && <div className="long-press-backdrop" onClick={close} />}

      {/* Popover content */}
      <div
        ref={popoverRef}
        popover="manual"
        className={cn("long-press-popover", className)}
        style={
          {
            // CSS Anchor Positioning
            positionAnchor: anchorName,
            positionArea: "bottom span-right",
            positionTryFallbacks: "flip-block",
            marginTop: "12px",
            marginLeft: "-4px",
          } as React.CSSProperties
        }
      >
        {children}
      </div>
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
        "bg-popover text-popover-foreground hover:bg-accent active:bg-accent",
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
        "w-[220px] overflow-hidden rounded-xl bg-popover text-popover-foreground p-1 shadow-lg ring-1 ring-border",
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
