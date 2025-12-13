import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

interface HighlightToolbarProps {
  position: { x: number; y: number };
  onColorSelect: (color: HighlightColor) => void;
  onClose: () => void;
  currentColor?: HighlightColor;
  onDelete?: () => void;
}

export function HighlightToolbar({
  position,
  onColorSelect,
  onClose,
  currentColor,
  onDelete,
}: HighlightToolbarProps) {
  // Calculate position directly to avoid layout thrashing/jumping
  const toolbarWidth = 160; // Reduced width
  const toolbarHeight = 48; // Reduced height
  const padding = 12;

  let x = position.x - toolbarWidth / 2;
  let y = position.y - toolbarHeight - padding;

  // Keep toolbar within viewport
  if (typeof window !== "undefined") {
    const viewportWidth = window.innerWidth;

    // Adjust horizontal position
    if (x < padding) {
      x = padding;
    } else if (x + toolbarWidth > viewportWidth - padding) {
      x = viewportWidth - toolbarWidth - padding;
    }

    // Adjust vertical position (show below if not enough space above)
    if (y < padding) {
      y = position.y + toolbarHeight + padding;
    }
  }

  // Close toolbar when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is inside the toolbar or on an existing highlight (for edit mode)
      if (
        !target.closest(".highlight-toolbar") &&
        !target.closest(".epub-highlight")
      ) {
        onClose();
      }
    };

    // Add a small delay to prevent immediate closing
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="highlight-toolbar fixed z-50 flex items-center gap-3 md:gap-2 p-2 rounded-full bg-background shadow-xl border border-border animate-in fade-in zoom-in-95 duration-200"
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
    >
      {HIGHLIGHT_COLORS.map((color) => {
        const handlePointerDown = () => {
          const isRemoveExistingHighlight =
            currentColor && color.name === currentColor && onDelete;
          if (isRemoveExistingHighlight) {
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
              "cursor-pointer w-10 h-10 md:w-6 md:h-6 rounded-full transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400 shadow-sm",
              "border border-black/5 hover:border-black/10",
              currentColor &&
                color.name === currentColor &&
                "ring-2 ring-offset-2 ring-gray-900",
            )}
            style={{ backgroundColor: `var(--${color.name}-secondary)` }}
            aria-label={
              currentColor && color.name === currentColor
                ? "Delete highlight"
                : `Highlight with ${color.name}`
            }
            title={
              currentColor && color.name === currentColor
                ? "Delete highlight"
                : `Highlight with ${color.name}`
            }
          />
        );
      })}
    </div>
  );
}
