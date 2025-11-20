import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

interface HighlightDeletePopoverProps {
  position: { x: number; y: number };
  currentColor: HighlightColor;
  onColorSelect: (color: HighlightColor) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function HighlightDeletePopover({
  position,
  currentColor,
  onColorSelect,
  onDelete,
  onClose,
}: HighlightDeletePopoverProps) {
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

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest(".highlight-delete-popover") &&
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
      className="highlight-delete-popover fixed z-50 flex items-center gap-2 p-2 rounded-full bg-white shadow-xl border border-gray-100 animate-in fade-in zoom-in-95 duration-200"
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color.name}
          onClick={() => {
            if (color.name === currentColor) {
              onDelete();
            } else {
              onColorSelect(color.name);
            }
          }}
          className={cn(
            "w-6 h-6 rounded-full transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400 shadow-sm",
            "border border-black/5 hover:border-black/10",
            color.name === currentColor && "ring-2 ring-offset-2 ring-gray-900"
          )}
          style={{ backgroundColor: color.hex }}
          aria-label={
            color.name === currentColor
              ? "Delete highlight"
              : `Change highlight to ${color.name}`
          }
          title={
            color.name === currentColor
              ? "Delete highlight"
              : `Change highlight to ${color.name}`
          }
        />
      ))}
    </div>
  );
}
