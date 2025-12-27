"use client";

import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

// ============================================================================
// Context
// ============================================================================

interface LongPressMenuContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  triggerRect: DOMRect | null;
  setTriggerRect: (rect: DOMRect | null) => void;
  layoutId: string;
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
  /** Duration in ms before long-press triggers. Default: 500ms */
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
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const layoutId = useId();

  const open = React.useCallback(() => {
    if (hapticFeedback && navigator.vibrate) {
      navigator.vibrate(10);
    }
    setIsOpen(true);
  }, [hapticFeedback]);

  const close = React.useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <LongPressMenuContext.Provider
      value={{ isOpen, open, close, triggerRect, setTriggerRect, layoutId }}
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
  const { isOpen, open, close, setTriggerRect } = useLongPressMenu();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
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

    timerRef.current = setTimeout(() => {
      if (isPressingRef.current && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setTriggerRect(rect);
        open();
      }
    }, pressDelay);
  };

  const handlePressEnd = () => {
    isPressingRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handlePressCancel = () => {
    isPressingRef.current = false;
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
  const { isOpen, layoutId } = useLongPressMenu();

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

  return (
    <div
      ref={ref}
      className={cn("touch-none select-none", className)}
      onTouchStart={handleTouchStart}
      onTouchEnd={onPressEnd}
      onTouchCancel={onPressCancel}
      onMouseDown={handleMouseDown}
      onMouseUp={onPressEnd}
      onMouseLeave={onPressCancel}
      onContextMenu={handleContextMenu}
    >
      {/* When closed, show the content with layoutId for shared element animation */}
      {/* Exit animation uses this element's transition - fast ease-out */}
      {!isOpen && (
        <motion.div
          layoutId={layoutId}
          transition={{
            duration: 0.2,
            ease: [0.32, 0.72, 0, 1], // Custom ease-out curve
          }}
        >
          {children}
        </motion.div>
      )}
      {/* When open, keep a placeholder to maintain layout */}
      {isOpen && <div style={{ visibility: "hidden" }}>{children}</div>}
    </div>
  );
}
LongPressMenuTrigger.displayName = "LongPressMenuTrigger";

// ============================================================================
// Content (Overlay + Cloned Content + Menu)
// ============================================================================

interface LongPressMenuContentProps {
  children: React.ReactNode;
  className?: string;
}

function LongPressMenuContent({
  children,
  className,
}: LongPressMenuContentProps) {
  const { isOpen, close, triggerRect } = useLongPressMenu();

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && triggerRect && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xl"
            onClick={close}
          />

          {/* Content container - centered */}
          <motion.div
            initial={{ opacity: 0, scale: 1 }}
            animate={{ opacity: 1, scale: 1.1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
              "flex flex-col items-center gap-3",
              className,
            )}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ============================================================================
// Preview - renders a preview of the trigger content with shared layoutId
// ============================================================================

interface LongPressMenuPreviewProps {
  children: React.ReactNode;
  className?: string;
}

function LongPressMenuPreview({
  children,
  className,
}: LongPressMenuPreviewProps) {
  const { triggerRect, layoutId } = useLongPressMenu();

  if (!triggerRect) return null;

  return (
    <motion.div
      layoutId={layoutId}
      className={cn("pointer-events-none", className)}
      style={{
        width: triggerRect.width,
      }}
      transition={{
        type: "spring",
        damping: 26, // Lower damping = more bounce/overshoot
        stiffness: 400, // Higher stiffness = faster
      }}
    >
      {children}
    </motion.div>
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
    <motion.button
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{
        type: "spring",
        damping: 20,
        stiffness: 400,
      }}
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
    </motion.button>
  );
}

// ============================================================================
// Items Container - groups menu items with staggered animation
// ============================================================================

interface LongPressMenuItemsProps {
  children: React.ReactNode;
  className?: string;
}

function LongPressMenuItems({ children, className }: LongPressMenuItemsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        type: "spring",
        damping: 15, // Lower damping = bouncy overshoot
        stiffness: 400,
      }}
      className={cn(
        "w-full min-w-[200px] overflow-hidden rounded-xl bg-popover p-1 shadow-lg ring-1 ring-border",
        className,
      )}
    >
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: {
            transition: {
              staggerChildren: 0.03,
              delayChildren: 0.05,
            },
          },
        }}
      >
        {children}
      </motion.div>
    </motion.div>
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
  LongPressMenuPreview,
  LongPressMenuSeparator,
  LongPressMenuTrigger,
};
