export const SHORT_HIGHLIGHT_CARD_HEIGHT = 208;
export const COMPACT_HIGHLIGHT_CARD_HEIGHT = 120;

export type HighlightCardPresentation =
  | "word-cloud"
  | "compact-quote"
  | "quote";

export function getHighlightWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function usesWordCloudHighlightStyle(text: string): boolean {
  const wordCount = getHighlightWordCount(text);
  return wordCount >= 1 && wordCount <= 3;
}

export function getHighlightCardPresentation(
  text: string,
  renderedLineCount: number,
): HighlightCardPresentation {
  if (usesWordCloudHighlightStyle(text)) return "word-cloud";
  if (getHighlightWordCount(text) > 3 && renderedLineCount === 1) {
    return "compact-quote";
  }

  return "quote";
}
