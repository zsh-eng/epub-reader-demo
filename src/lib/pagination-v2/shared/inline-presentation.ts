import type { InlineRole } from "./types";

const DEFAULT_FONT_SIZE_PX = 16;
const NOTE_REF_MIN_WIDTH_FACTOR = 1.78;
const NOTE_REF_PADDING_X_FACTOR = 0.36;
const NOTE_REF_HEIGHT_FACTOR = 1.52;
const NOTE_REF_RAISE_FACTOR = 0.42;
const SUPERSCRIPT_RAISE_FACTOR = 0.34;

export const SUPERSCRIPT_FONT_SCALE = 0.72;

export interface NoteRefMetrics {
  totalWidthPx: number;
  heightPx: number;
  raisePx: number;
}

/**
 * The pagination engine measures inline content before it is rendered. These
 * helpers centralize the badge/superscript metrics so preparation and DOM
 * output reserve the same width.
 */
export function getFontSizePx(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  if (!match) return DEFAULT_FONT_SIZE_PX;

  const size = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_FONT_SIZE_PX;
}

export function getNoteRefMetrics(
  font: string,
  textWidthPx: number,
): NoteRefMetrics {
  const fontSizePx = getFontSizePx(font);
  const horizontalPaddingPx = Math.round(fontSizePx * NOTE_REF_PADDING_X_FACTOR);
  const minWidthPx = Math.round(fontSizePx * NOTE_REF_MIN_WIDTH_FACTOR);
  const totalWidthPx = Math.max(
    minWidthPx,
    Math.round(textWidthPx + horizontalPaddingPx * 2),
  );

  return {
    totalWidthPx,
    heightPx: Math.round(fontSizePx * NOTE_REF_HEIGHT_FACTOR),
    raisePx: Math.round(fontSizePx * NOTE_REF_RAISE_FACTOR),
  };
}

export function getInlineChromeWidthPx(
  inlineRole: InlineRole | undefined,
  font: string,
  textWidthPx: number,
): number {
  if (inlineRole !== "note-ref") return 0;

  return Math.max(0, getNoteRefMetrics(font, textWidthPx).totalWidthPx - textWidthPx);
}

export function getInlineRaisePx(
  inlineRole: InlineRole | undefined,
  font: string,
): number {
  const fontSizePx = getFontSizePx(font);
  if (inlineRole === "note-ref") {
    return Math.round(fontSizePx * NOTE_REF_RAISE_FACTOR);
  }
  if (inlineRole === "superscript") {
    return Math.round(fontSizePx * SUPERSCRIPT_RAISE_FACTOR);
  }
  return 0;
}
