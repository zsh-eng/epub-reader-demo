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

  // Calculate position directly to avoid layout thrashing/jumping
  // Vertical layout: colors on top, input bar below
  // Desktop: ~200px width, ~88px height (colors row + input row)
  // Mobile: ~260px width, ~120px height
  const toolbarWidth = isMobile ? 260 : 220;
  const toolbarHeight = isMobile ? 120 : 88;
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
      className="highlight-toolbar fixed z-50 flex flex-col gap-2 p-2 rounded-2xl bg-background shadow-xl border border-border animate-in fade-in zoom-in-95 duration-200"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${toolbarWidth}px`,
      }}
    >
      {/* Color buttons row */}
      <div className="flex items-center justify-center gap-3 md:gap-2">
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
