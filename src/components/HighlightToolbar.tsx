import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@/lib/highlight-constants";
import { useEffect, useState } from "react";

interface HighlightToolbarProps {
  position: { x: number; y: number };
  onColorSelect: (color: HighlightColor) => void;
  onClose: () => void;
}

export function HighlightToolbar({
  position,
  onColorSelect,
  onClose,
}: HighlightToolbarProps) {
  const [toolbarPosition, setToolbarPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    // Position the toolbar above the selection, centered
    const toolbarWidth = 200; // Approximate width
    const toolbarHeight = 60; // Approximate height
    const padding = 10;

    let x = position.x - toolbarWidth / 2;
    let y = position.y - toolbarHeight - padding;

    // Keep toolbar within viewport
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

    setToolbarPosition({ x, y });
  }, [position]);

  // Close toolbar when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".highlight-toolbar")) {
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

  return (
    <div
      className="highlight-toolbar fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-3"
      style={{
        left: `${toolbarPosition.x}px`,
        top: `${toolbarPosition.y}px`,
      }}
    >
      <div className="flex items-center gap-2">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.name}
            onClick={() => onColorSelect(color.name)}
            className="w-10 h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
            style={{ backgroundColor: color.value }}
            aria-label={`Highlight with ${color.name}`}
            title={`Highlight with ${color.name}`}
          />
        ))}
      </div>
    </div>
  );
}
