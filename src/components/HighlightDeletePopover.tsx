import { Trash2 } from "lucide-react";
import { useEffect } from "react";

interface HighlightDeletePopoverProps {
  position: { x: number; y: number };
  onDelete: () => void;
  onClose: () => void;
}

export function HighlightDeletePopover({
  position,
  onDelete,
  onClose,
}: HighlightDeletePopoverProps) {
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
      className="highlight-delete-popover fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <button
        onClick={onDelete}
        className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
        aria-label="Delete highlight"
      >
        <Trash2 size={16} />
        <span className="font-medium">Delete</span>
      </button>
    </div>
  );
}
