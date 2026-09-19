import { MessageSquarePlus } from "lucide-react";
import {
  HIGHLIGHT_COLORS,
  type AnnotationColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "motion/react";

interface MobileHighlightBarProps {
  onColorSelect: (color: AnnotationColor) => void;
  onClose: () => void;
  currentColor?: AnnotationColor;
  onDelete?: () => void;
  onAddNote?: () => void;
  isNavVisible: boolean;
  showBackdrop?: boolean;
}

export function MobileHighlightBar({
  onColorSelect,
  onClose,
  currentColor,
  onDelete,
  onAddNote,
  isNavVisible,
  showBackdrop = true,
}: MobileHighlightBarProps) {
  const reducedMotion = useReducedMotion();
  return (
    <>
      {showBackdrop && (
        <motion.div
          className="fixed inset-0 z-40"
          onPointerDown={onClose}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeInOut" }}
        />
      )}

      {/* Highlight bar */}
      <div
        className={cn(
          "fixed left-0 right-0 z-50 flex justify-center px-4 transition-[bottom] duration-150 ease-out motion-reduce:transition-none",
        )}
        style={{
          bottom: isNavVisible
            ? `calc(4.5rem + env(safe-area-inset-bottom))`
            : "calc(1rem + env(safe-area-inset-bottom))",
        }}
      >
        <motion.div
          className="flex items-center gap-3 p-3 rounded-full bg-background/80 dark:bg-input/30 backdrop-blur-md shadow-xl border border-border"
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 2, filter: "blur(4px)" }}
          transition={{
            opacity: { duration: 0.15, ease: "easeInOut" },
            y: { duration: 0.12, ease: [0.23, 1, 0.32, 1] },
            filter: { duration: 0.12 },
          }}
        >
          {onAddNote && (
            <button
              aria-label="Note on highlight"
              onClick={onAddNote}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-transform duration-150 active:scale-[0.97] motion-reduce:active:scale-100"
            >
              <MessageSquarePlus size={17} />
            </button>
          )}
          {HIGHLIGHT_COLORS.map((color) => {
            const isCurrentColor = currentColor && color.name === currentColor;

            const handleClick = () => {
              if (isCurrentColor && onDelete) {
                onDelete();
                return;
              }
              onColorSelect(color.name);
            };

            return (
              <button
                key={color.name}
                type="button"
                onPointerDown={(event) => {
                  // Keep the native text selection until click commits the action.
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={handleClick}
                className={cn(
                  "cursor-pointer w-[min(13vw,3.5rem)] h-11 rounded-full transition-[scale,border-color] duration-150 active:scale-95 motion-reduce:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 shadow-sm",
                  "border border-black/5 active:border-black/10",
                  isCurrentColor && "ring-2 ring-offset-2 ring-foreground/50",
                )}
                style={{
                  backgroundColor: `var(--${color.name}-secondary)`,
                }}
                aria-label={
                  isCurrentColor
                    ? "Delete highlight"
                    : `Highlight with ${color.name}`
                }
              />
            );
          })}
        </motion.div>
      </div>
    </>
  );
}
