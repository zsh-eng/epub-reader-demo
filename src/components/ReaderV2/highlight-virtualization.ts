import type { Highlight } from "@/types/highlight";
import { applyHighlights } from "@zsh-eng/text-highlighter";

export interface VirtualChapterSource {
  html: string;
  highlightedHtml: string;
}

function createVirtualContainer(html: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

function sortHighlightsByOffset(a: Highlight, b: Highlight): number {
  if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset;
  if (a.endOffset !== b.endOffset) return a.endOffset - b.endOffset;
  return a.id.localeCompare(b.id);
}

export function buildHighlightSignature(highlights: Highlight[]): string {
  return highlights
    .slice()
    .sort(sortHighlightsByOffset)
    .map(
      (highlight) =>
        `${highlight.id}:${highlight.startOffset}:${highlight.endOffset}:${highlight.color}`,
    )
    .join("|");
}

export function buildHighlightsBySpineItemId(
  highlights: Highlight[],
): Map<string, Highlight[]> {
  const bySpineItemId = new Map<string, Highlight[]>();

  for (const highlight of highlights) {
    const existing = bySpineItemId.get(highlight.spineItemId) ?? [];
    existing.push(highlight);
    bySpineItemId.set(highlight.spineItemId, existing);
  }

  for (const chapterHighlights of bySpineItemId.values()) {
    chapterHighlights.sort(sortHighlightsByOffset);
  }

  return bySpineItemId;
}

export function applyHighlightsToChapterHtml(
  html: string,
  highlights: Highlight[],
): string {
  if (highlights.length === 0) return html;

  const container = createVirtualContainer(html);

  const sortedHighlights = highlights.slice().sort(sortHighlightsByOffset);

  applyHighlights(
    container,
    sortedHighlights.map((highlight) => ({
      id: highlight.id,
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset,
      selectedText: highlight.selectedText,
    })),
    {
      tagName: "mark",
      className: "epub-highlight",
      attributes: {},
    },
  );

  const colorByHighlightId = new Map(
    sortedHighlights.map((highlight) => [highlight.id, highlight.color]),
  );

  const marks = container.querySelectorAll("mark[data-highlight-id]");
  for (const mark of Array.from(marks)) {
    const id = mark.getAttribute("data-highlight-id");
    if (!id) continue;
    const color = colorByHighlightId.get(id);
    if (!color) continue;
    mark.setAttribute("data-color", color);
  }

  return container.innerHTML;
}

export function applyChapterHighlights(
  source: VirtualChapterSource,
  highlights: Highlight[],
): VirtualChapterSource {
  return {
    ...source,
    highlightedHtml: applyHighlightsToChapterHtml(source.html, highlights),
  };
}
