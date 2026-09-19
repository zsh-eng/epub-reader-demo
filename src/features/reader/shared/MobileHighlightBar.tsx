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

        return (
          <button
            key={color.name}
            type="button"
            onPointerDown={(event) => {
              // Keep the native text selection until click commits the action.
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={() => {
              if (!isCurrentColor) onColorSelect(color.name);
            }}
            aria-pressed={Boolean(isCurrentColor)}
            className={cn(
              "cursor-pointer w-full max-w-16 flex-1 h-8 rounded-full transition-[scale,border-color] duration-150 active:scale-95 motion-reduce:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
              "border border-black/5 active:border-black/10",
              isCurrentColor && "ring-2 ring-offset-2 ring-foreground/50",
            )}
            style={{
              backgroundColor: `var(--${color.name}-secondary)`,
            }}
            aria-label={`Highlight with ${color.name}`}
          />
        );
      })}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="h-8 shrink-0 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Remove highlight"
        >
          Remove
        </button>
      )}
    </div>
  );
}
