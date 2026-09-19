import {
  HIGHLIGHT_COLORS,
  type AnnotationColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";

/** Compact color tools. The mobile composer owns placement and keyboard tracking. */
export function MobileHighlightBar({
  onColorSelect,
  currentColor,
  onDelete,
}: {
  onColorSelect: (color: AnnotationColor) => void;
  currentColor?: AnnotationColor;
  onDelete?: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Highlight colors"
      className="flex items-center justify-center gap-3 px-4 pb-3 pt-2"
    >
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
              "cursor-pointer w-full max-w-16 flex-1 h-8 rounded-full transition-[scale,border-color] duration-150 active:scale-95 motion-reduce:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
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
    </div>
  );
}
