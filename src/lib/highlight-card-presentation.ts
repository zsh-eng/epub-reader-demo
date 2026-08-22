export const SHORT_HIGHLIGHT_CARD_HEIGHT = 208;

export function getHighlightWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function usesWordCloudHighlightStyle(text: string): boolean {
  const wordCount = getHighlightWordCount(text);
  return wordCount >= 1 && wordCount <= 3;
}
