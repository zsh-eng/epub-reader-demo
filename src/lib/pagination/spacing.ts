import type { LayoutTheme } from "./types";

export const CODE_CHROME_PX = 14;
export const DEFAULT_INTRINSIC_WIDTH = 600;
export const DEFAULT_INTRINSIC_HEIGHT = 400;
export const DEFAULT_ASPECT_RATIO = 3 / 4;

export function headingScale(tag: string): number {
  switch (tag) {
    case "h1":
      return 2;
    case "h2":
      return 1.5;
    case "h3":
      return 1.25;
    case "h4":
      return 1.1;
    default:
      return 1;
  }
}

export function getLineHeight(tag: string, theme: LayoutTheme): number {
  const scale = headingScale(tag);
  return Math.round(theme.baseFontSizePx * scale * theme.lineHeightFactor);
}

export function getBlockSpacing(
  tag: string,
  theme: LayoutTheme,
): { above: number; below: number } {
  if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
    return {
      above: theme.baseFontSizePx * theme.headingSpaceAbove * headingScale(tag),
      below: theme.baseFontSizePx * theme.headingSpaceBelow,
    };
  }
  return {
    above: 0,
    below: theme.baseFontSizePx * theme.paragraphSpacingFactor,
  };
}
