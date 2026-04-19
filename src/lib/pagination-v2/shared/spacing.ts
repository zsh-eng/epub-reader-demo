import type { BlockTag, LayoutTheme } from "./types";

export const CODE_CHROME_PX = 14;
export const DEFAULT_INTRINSIC_WIDTH = 600;
export const DEFAULT_INTRINSIC_HEIGHT = 400;
export const DEFAULT_ASPECT_RATIO = 3 / 4;
export const BLOCKQUOTE_BORDER_LEFT_PX = 4;
export const BLOCKQUOTE_PADDING_LEFT_EM = 1.5;
export const BLOCKQUOTE_MARGIN_Y_EM = 1.5;
// Keep captions visually secondary without making them look detached from the figure.
export const FIGCAPTION_FONT_SCALE = 0.8;
export const FIGCAPTION_MAX_LINE_HEIGHT_FACTOR = 1.35;
export const FIGCAPTION_MARGIN_TOP_EM = 0.55;
export const FIGCAPTION_MARGIN_BOTTOM_EM = 1.5;
export const LARGE_HEADING_LINE_HEIGHT_FACTOR = 1.12;
export const MEDIUM_HEADING_LINE_HEIGHT_FACTOR = 1.18;
export const SMALL_HEADING_LINE_HEIGHT_FACTOR = 1.24;

type LayoutBlockKind = BlockTag | "image";

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

export function getBlockFontScale(tag: string): number {
  if (tag === "figcaption") {
    return FIGCAPTION_FONT_SCALE;
  }

  return headingScale(tag);
}

function getBlockLineHeightFactor(
  tag: string,
  theme: LayoutTheme,
): number | null {
  switch (tag) {
    case "h1":
    case "h2":
      return LARGE_HEADING_LINE_HEIGHT_FACTOR;
    case "h3":
    case "h4":
      return MEDIUM_HEADING_LINE_HEIGHT_FACTOR;
    case "h5":
    case "h6":
      return SMALL_HEADING_LINE_HEIGHT_FACTOR;
    case "figcaption":
      return Math.min(
        theme.lineHeightFactor,
        FIGCAPTION_MAX_LINE_HEIGHT_FACTOR,
      );
    default:
      return null;
  }
}

export function getLineHeight(tag: string, theme: LayoutTheme): number {
  const scale = getBlockFontScale(tag);
  const lineHeightFactor =
    getBlockLineHeightFactor(tag, theme) ?? theme.lineHeightFactor;

  return Math.round(theme.baseFontSizePx * scale * lineHeightFactor);
}

export function getBlockSpacing(
  tag: LayoutBlockKind,
  theme: LayoutTheme,
): { above: number; below: number } {
  if (tag === "image") {
    return {
      above: 0,
      below: theme.baseFontSizePx * theme.paragraphSpacingFactor,
    };
  }

  if (tag === "blockquote") {
    const quoteSpacing = theme.baseFontSizePx * BLOCKQUOTE_MARGIN_Y_EM;
    return {
      above: quoteSpacing,
      below: quoteSpacing,
    };
  }

  if (tag === "figcaption") {
    return {
      above: theme.baseFontSizePx * FIGCAPTION_MARGIN_TOP_EM,
      below: theme.baseFontSizePx * FIGCAPTION_MARGIN_BOTTOM_EM,
    };
  }

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

export function getCollapsedBlockGap(
  previousKind: LayoutBlockKind | null,
  currentKind: LayoutBlockKind,
  theme: LayoutTheme,
  previousMarginBelow: number,
): number {
  if (!previousKind) {
    return 0;
  }

  if (previousKind === "image" && currentKind === "figcaption") {
    return theme.baseFontSizePx * FIGCAPTION_MARGIN_TOP_EM;
  }

  return Math.max(
    previousMarginBelow,
    getBlockSpacing(currentKind, theme).above,
  );
}

export function getBlockInsetLeft(tag: string, theme: LayoutTheme): number {
  if (tag !== "blockquote") return 0;

  return (
    theme.baseFontSizePx * BLOCKQUOTE_PADDING_LEFT_EM +
    BLOCKQUOTE_BORDER_LEFT_PX
  );
}
