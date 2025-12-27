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
    /* Popover container - positions both clone and menu */
    .long-press-popover {
      border: none;
      padding: 0;
      background: transparent;
      margin: 0;
      overflow: visible;
      /* Remove default positioning - we handle it manually */
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      pointer-events: none;
    }

    /* Allow pointer events on children */
    .long-press-popover > * {
      pointer-events: auto;
    }

    /* Native backdrop - covers entire viewport including dynamic island */
    .long-press-popover::backdrop {
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);

      /* Entry animation */
      opacity: 1;
      transition:
        opacity 0.25s ease-out,
        overlay 0.25s ease-out allow-discrete,
        display 0.25s ease-out allow-discrete;
    }

    @starting-style {
      .long-press-popover:popover-open::backdrop {
        opacity: 0;
      }
    }

    /* Exit animation for backdrop */
    .long-press-popover:not(:popover-open)::backdrop {
      opacity: 0;
    }

    /* Cloned element container - positioned at original element's location */
    .long-press-clone-container {
      position: absolute;
      pointer-events: none;
      /* Entry animation - scale up from pressed state */
      transform: scale(1);
      opacity: 1;
      transition: transform 0.15s ease-out, opacity 0.15s ease-out;
    }

    @starting-style {
      .long-press-clone-container {
        transform: scale(0.96);
        opacity: 0.8;
      }
    }

    /* Clone wrapper to add shadow */
    .long-press-clone-wrapper {
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.3);
      border-radius: 12px;
      overflow: hidden;
    }

    /* Menu container - anchored below the clone */
    .long-press-menu-container {
      position: absolute;
      /* Entry animation */
      opacity: 1;
      transform: translateY(0) scale(1);
      transition:
        opacity 0.2s ease-out,
        transform 0.2s ease-out;
    }

    @starting-style {
      .long-press-menu-container {
        opacity: 0;
        transform: translateY(-8px) scale(0.96);
      }
    }

    /* Trigger animations - uses CSS custom property for press duration */
    .long-press-trigger {
      touch-action: none;
      user-select: none;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      /* Default press duration, overridden by inline style */
      --press-duration: 400ms;
    }

    /* Press down - slow, synced with long press delay */
    .long-press-trigger[data-pressing="true"] {
      transform: scale(0.96);
      transition: transform var(--press-duration) ease-out;
    }

    /* When menu is open, hide the original (clone is visible in popover) */
    .long-press-trigger[data-open="true"] {
      visibility: hidden;
    }

    /* Default state - fast recovery */
    .long-press-trigger:not([data-pressing="true"]):not([data-open="true"]) {
      transform: scale(1);
      transition: transform 0.15s ease-out;
    }
  `;
  document.head.appendChild(style);
}

// ============================================================================
// Context
// ============================================================================

interface TriggerRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface LongPressMenuContextValue {
  isOpen: boolean;
  isPressing: boolean;
  open: (triggerElement: HTMLElement) => void;
  close: () => void;
  pressDelay: number;
  setIsPressing: (pressing: boolean) => void;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  triggerRect: TriggerRect | null;
  triggerElement: HTMLElement | null;
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
  /** Duration in ms before long-press triggers. Default: 400ms */
  pressDelay?: number;
  /** Whether to trigger haptic feedback. Default: true */
  hapticFeedback?: boolean;
}

function LongPressMenu({
  children,
  pressDelay = 400,
  hapticFeedback = true,
}: LongPressMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [triggerRect, setTriggerRect] = useState<TriggerRect | null>(null);
  const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(
    null,
  );
  const popoverRef = useRef<HTMLDivElement>(null);

  // Inject styles on mount
  useEffect(() => {
    injectStyles();
  }, []);

  const open = React.useCallback(
    (element: HTMLElement) => {
      if (hapticFeedback && navigator.vibrate) {
        navigator.vibrate(10);
      }

      // Capture trigger position and store element reference
      const rect = element.getBoundingClientRect();
      setTriggerRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });

      // Store reference to trigger element for cloning
      setTriggerElement(element);

      setIsOpen(true);
      setIsPressing(false);

      // Show the popover
      popoverRef.current?.showPopover();
    },
    [hapticFeedback],
  );

  const close = React.useCallback(() => {
    setIsOpen(false);
    setTriggerRect(null);
    setTriggerElement(null);
    // With popover="auto", hidePopover is optional but calling it ensures sync
    popoverRef.current?.hidePopover();
  }, []);

  // Sync React state with native popover toggle events (for light-dismiss)
  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;

    const handleToggle = (e: Event) => {
      const toggleEvent = e as ToggleEvent;
      if (toggleEvent.newState === "closed") {
        setIsOpen(false);
        setIsPressing(false);
        setTriggerRect(null);
        setTriggerElement(null);
      }
    };

    popover.addEventListener("toggle", handleToggle);
    return () => popover.removeEventListener("toggle", handleToggle);
  }, []);

  return (
    <LongPressMenuContext.Provider
      value={{
        isOpen,
        isPressing,
        open,
        close,
        pressDelay,
        setIsPressing,
        popoverRef,
        triggerRect,
        triggerElement,
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
        open(triggerRef.current);
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
  const { isOpen, isPressing, pressDelay } = useLongPressMenu();

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
          "--press-duration": `${pressDelay}ms`,
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
// Content (uses native popover=auto + cloned element + native backdrop)
// ============================================================================

interface LongPressMenuContentProps {
  children: React.ReactNode;
  className?: string;
}

function LongPressMenuContent({
  children,
  className,
}: LongPressMenuContentProps) {
  const { popoverRef, triggerRect, triggerElement } = useLongPressMenu();
  const cloneContainerRef = useRef<HTMLDivElement>(null);

  // Clone the trigger element using native DOM methods
  useEffect(() => {
    const container = cloneContainerRef.current;
    if (!container || !triggerElement) return;

    // Clear any existing clone
    container.innerHTML = "";

    // Clone the trigger element's content
    const clone = triggerElement.cloneNode(true) as HTMLElement;

    // Remove data attributes and event-related classes from clone
    clone.removeAttribute("data-pressing");
    clone.removeAttribute("data-open");
    clone.classList.remove("long-press-trigger");

    // Reset any transforms on the clone
    clone.style.transform = "none";
    clone.style.visibility = "visible";

    container.appendChild(clone);

    // Cleanup on unmount or when trigger changes
    return () => {
      container.innerHTML = "";
    };
  }, [triggerElement]);

  // Calculate menu position (below the clone)
  const menuTop = triggerRect ? triggerRect.top + triggerRect.height + 12 : 0;
  const menuLeft = triggerRect ? triggerRect.left : 0;

  return (
    <div
      ref={popoverRef}
      popover="auto"
      className={cn("long-press-popover", className)}
      style={{
        top: triggerRect ? triggerRect.top : 0,
        left: triggerRect ? triggerRect.left : 0,
      }}
    >
      {/* Cloned element container - content added via useEffect */}
      {triggerRect && (
        <div
          ref={cloneContainerRef}
          className="long-press-clone-container"
          style={{
            width: triggerRect.width,
            height: triggerRect.height,
          }}
        />
      )}

      {/* Menu - positioned below the clone */}
      {triggerRect && (
        <div
          className="long-press-menu-container"
          style={{
            top: menuTop,
            left: menuLeft,
          }}
        >
          {children}
        </div>
      )}
    </div>
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
