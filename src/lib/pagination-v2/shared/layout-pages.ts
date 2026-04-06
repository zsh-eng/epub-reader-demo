import { layoutPreWrapLines, layoutTextLines } from "./layout-text-lines";
import { getBlockSpacing, getLineHeight } from "./spacing";
import type {
  LayoutTheme,
  Page,
  PaginationResult,
  PreparedBlock,
  PreparedTextBlock,
} from "./types";

function createPage(index: number): Page & { usedHeight: number } {
  return { index, slices: [], usedHeight: 0 };
}

export function layoutPages(
  preparedBlocks: PreparedBlock[],
  pageWidth: number,
  pageHeight: number,
  theme: LayoutTheme,
): PaginationResult {
  const startedAt = performance.now();

  if (preparedBlocks.length === 0) {
    return {
      pages: [{ index: 0, slices: [] }],
      diagnostics: { blockCount: 0, lineCount: 0, computeMs: 0 },
    };
  }

  const safeHeight = Math.max(120, pageHeight);
  const safeWidth = Math.max(140, pageWidth);

  const pages: Page[] = [];
  let current = createPage(0);
  let prevMarginBelow = 0;
  let totalLineCount = 0;

  const pushPage = () => {
    const { usedHeight: _, ...page } = current;
    pages.push(page);
    current = createPage(pages.length);
    prevMarginBelow = 0;
  };

  const addSpacer = (blockId: string, height: number) => {
    const requested = Math.max(0, height);
    if (requested <= 0) return;

    // Keep spacers atomic so a single spacer block never appears on multiple
    // pages with the same blockId (which breaks anchor resolution).
    const spacerHeight = Math.min(requested, safeHeight);
    const available = safeHeight - current.usedHeight;

    if (spacerHeight > available && current.slices.length > 0) {
      pushPage();
    }

    current.slices.push({
      type: "spacer",
      blockId,
      height: spacerHeight,
    });
    current.usedHeight += spacerHeight;
  };

  for (const block of preparedBlocks) {
    if (block.type === "page-break") {
      if (current.slices.length > 0) pushPage();
      prevMarginBelow = 0;
      continue;
    }

    if (block.type === "spacer") {
      addSpacer(block.id, theme.baseFontSizePx * 0.9);
      prevMarginBelow = 0;
      continue;
    }

    if (block.type === "image") {
      const spacing = getBlockSpacing("p", theme);
      const gap = Math.max(prevMarginBelow, spacing.above);

      // Only emit the gap when there is already content on this page. Crucially,
      // check whether the image will overflow *before* emitting the spacer: if
      // the image won't fit (with or without the gap), push the page first and
      // drop the gap. Emitting the spacer then pushing would leave it stranded
      // on the previous page, separated from the image it belongs to.
      // This matches standard print layout — top-of-page margins are suppressed.
      if (current.slices.length > 0) {
        const available = safeHeight - current.usedHeight;
        if (gap + block.intrinsicHeight <= available) {
          if (gap > 0) addSpacer(block.id, gap);
        } else {
          pushPage();
        }
      }

      let available = safeHeight - current.usedHeight;

      // Scale image to fit if larger than page
      let displayHeight = block.intrinsicHeight;
      let displayWidth = block.intrinsicWidth;
      if (displayHeight > safeHeight) {
        const scale = safeHeight / displayHeight;
        displayHeight = safeHeight;
        displayWidth = block.intrinsicWidth * scale;
      }
      displayWidth = Math.min(displayWidth, safeWidth);

      available = safeHeight - current.usedHeight;
      if (available <= 0) {
        pushPage();
        available = safeHeight;
      }
      displayHeight = Math.min(displayHeight, available);

      current.slices.push({
        type: "image",
        blockId: block.id,
        src: block.src,
        alt: block.alt,
        width: displayWidth,
        height: displayHeight,
      });
      current.usedHeight += displayHeight;

      prevMarginBelow = spacing.below;
      continue;
    }

    // Text block
    const textBlock = block as PreparedTextBlock;
    const spacing = getBlockSpacing(textBlock.tag, theme);

    // Margin collapsing
    const effectiveGap =
      current.slices.length === 0
        ? 0
        : Math.max(prevMarginBelow, spacing.above);
    if (effectiveGap > 0) addSpacer(textBlock.id, effectiveGap);

    const lines = textBlock.containsNewlines
      ? layoutPreWrapLines(textBlock.items, safeWidth)
      : layoutTextLines(textBlock.items, safeWidth);
    totalLineCount += lines.length;

    if (lines.length === 0) {
      prevMarginBelow = spacing.below;
      continue;
    }

    const lastLine = lines[lines.length - 1];
    if (lastLine) {
      lastLine.isLastInBlock = true;
    }

    const lineHeight = getLineHeight(textBlock.tag, theme);
    let lineIndex = 0;

    while (lineIndex < lines.length) {
      const available = safeHeight - current.usedHeight;
      if (available <= 0) {
        pushPage();
        continue;
      }

      let maxLines = Math.floor(available / lineHeight);
      if (maxLines <= 0) {
        if (current.slices.length > 0) {
          pushPage();
          continue;
        }
        maxLines = 1;
      }

      const take = Math.min(maxLines, lines.length - lineIndex);
      const sliceLines = lines.slice(lineIndex, lineIndex + take);

      current.slices.push({
        type: "text",
        blockId: textBlock.id,
        lineHeight,
        textAlign: theme.textAlign,
        lines: sliceLines,
      });
      current.usedHeight += take * lineHeight;
      lineIndex += take;
    }

    prevMarginBelow = spacing.below;
  }

  if (current.slices.length > 0 || pages.length === 0) {
    const { usedHeight: _, ...page } = current;
    pages.push(page);
  }

  return {
    pages,
    diagnostics: {
      blockCount: preparedBlocks.length,
      lineCount: totalLineCount,
      computeMs: performance.now() - startedAt,
    },
  };
}
