import { useIsMobile } from "@/hooks/use-mobile";
import {
  HIGHLIGHT_COLORS,
  type AnnotationColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import {
  EPUB_HIGHLIGHT_CLASS,
  HIGHLIGHT_TOOLBAR_CLASS,
} from "@/types/reader.types";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface HighlightToolbarProps {
  position: { x: number; y: number };
  onColorSelect: (color: AnnotationColor) => void;
  onClose: () => void;
  currentColor?: AnnotationColor;
  onDelete?: () => void;
  /** Called when user submits a note (creates invisible annotation + note) */
  onNoteSubmit?: (content: string) => void;
}

export function HighlightToolbar({
  position,
  onColorSelect,
  onClose,
  currentColor,
  onDelete,
  onNoteSubmit,
}: HighlightToolbarProps) {
  const isMobile = useIsMobile();
  const [noteText, setNoteText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isBareDesktopPicker = !isMobile && !onNoteSubmit;

  // Calculate position directly to avoid layout thrashing/jumping
  // Vertical layout: colors on top, input bar below
  // Desktop color-only mode is tightly fitted to the four larger swatches.
  // A note composer keeps the wider two-row surface.
  // Mobile: ~260px width, ~120px height
  const toolbarWidth = isBareDesktopPicker ? 164 : isMobile ? 260 : 220;
  const toolbarHeight = isBareDesktopPicker ? 32 : isMobile ? 120 : 88;
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
        !target.closest(`.${HIGHLIGHT_TOOLBAR_CLASS}`) &&
        !target.closest(`.${EPUB_HIGHLIGHT_CLASS}`)
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

  useHotkey("Escape", onClose, {
    conflictBehavior: "allow",
    preventDefault: false,
    requireReset: true,
    stopPropagation: false,
    meta: {
      name: "Close highlight toolbar",
      description: "Dismiss the active highlight controls",
    },
  });

  const handleNoteSubmit = () => {
    if (noteText.trim() && onNoteSubmit) {
      onNoteSubmit(noteText.trim());
      setNoteText("");
      onClose();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleNoteSubmit();
    }
  };

  return (
    <div
      className={cn(
        "highlight-toolbar fixed z-50 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-200",
        isBareDesktopPicker
          ? "bg-transparent"
          : "rounded-2xl border border-border bg-background p-2 shadow-xl",
      )}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${toolbarWidth}px`,
      }}
    >
      {/* Color buttons row */}
      <div className="flex items-center justify-center gap-3">
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
                "size-10 cursor-pointer rounded-full border-2 border-background/80 shadow-[0_2px_10px_hsl(var(--foreground)/0.18)]",
                "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95 md:size-8",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "[@media(hover:hover)_and_(pointer:fine)]:hover:scale-110",
                currentColor &&
                  color.name === currentColor &&
                  "ring-2 ring-foreground ring-offset-2 ring-offset-background",
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

      {/* Note input row */}
      {onNoteSubmit && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Add a note..."
            className="flex-1 px-3 py-1.5 text-sm rounded-full bg-muted border-0 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            onPointerDown={handleNoteSubmit}
            disabled={!noteText.trim()}
            className={cn(
              "p-2 rounded-full transition-all",
              noteText.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
            aria-label="Send note"
            title="Add note (creates annotation)"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
