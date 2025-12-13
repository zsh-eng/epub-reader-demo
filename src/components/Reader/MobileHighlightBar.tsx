import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";

interface MobileHighlightBarProps {
  onColorSelect: (color: HighlightColor) => void;
  onClose: () => void;
  currentColor?: HighlightColor;
  onDelete?: () => void;
  isNavVisible: boolean;
}

export function MobileHighlightBar({
  onColorSelect,
  onClose,
  currentColor,
  onDelete,
  isNavVisible,
}: MobileHighlightBarProps) {
  return (
    <>
      {/* Backdrop to close on tap outside */}
      <motion.div
        className="fixed inset-0 z-40"
        onPointerDown={onClose}
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: "easeInOut" }}
      />

      {/* Highlight bar */}
      <div
        className={cn(
          "fixed left-0 right-0 z-50 flex justify-center px-4 transition-all duration-300 ease-out",
          isNavVisible ? "bottom-18" : "bottom-4",
        )}
      >
        <motion.div
          className="flex items-center gap-3 p-3 rounded-full bg-background/80 dark:bg-input/30 backdrop-blur-md shadow-xl border border-border"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{
            opacity: { duration: 0.15, ease: "easeInOut" },
            y: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
          }}
        >
          {HIGHLIGHT_COLORS.map((color) => {
            const isCurrentColor = currentColor && color.name === currentColor;

            const handlePointerDown = (e: React.PointerEvent) => {
              e.stopPropagation();
              if (isCurrentColor && onDelete) {
                onDelete();
                return;
              }
              onColorSelect(color.name);
            };

            return (
              <button
                key={color.name}
                onPointerDown={handlePointerDown}
                className={cn(
                  "cursor-pointer w-[16vw] h-8 rounded-full transition-all active:scale-95 focus:outline-none shadow-sm",
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
