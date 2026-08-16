import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@/lib/highlight-constants";

export const ALL_HIGHLIGHT_COLORS: HighlightColor[] = HIGHLIGHT_COLORS.map(
  ({ name }) => name,
);

/**
 * Keeps color filtering fast for the common single-color action while ensuring
 * that the UI never enters an empty selection state.
 */
export function toggleHighlightColorSelection(
  selectedColors: readonly HighlightColor[],
  color: HighlightColor,
): HighlightColor[] {
  if (selectedColors.length === ALL_HIGHLIGHT_COLORS.length) {
    return [color];
  }

  if (selectedColors.length === 1 && selectedColors[0] === color) {
    return [...ALL_HIGHLIGHT_COLORS];
  }

  const nextSelection = new Set(selectedColors);
  if (nextSelection.has(color)) {
    nextSelection.delete(color);
  } else {
    nextSelection.add(color);
  }

  return ALL_HIGHLIGHT_COLORS.filter((name) => nextSelection.has(name));
}
