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
    let remaining = Math.max(0, height);
    while (remaining > 0) {
      const available = safeHeight - current.usedHeight;
      if (available <= 0) {
        pushPage();
        continue;
      }
      const chunk = Math.min(remaining, available);
      if (chunk <= 0) break;

      current.slices.push({
        type: "spacer",
        blockId,
        height: chunk,
      });
      current.usedHeight += chunk;
      remaining -= chunk;

      if (remaining > 0) pushPage();
    }
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

      // Round to whole pixels so the browser's rendered line height matches
      // what our layout engine assumes during pagination.
      //
      // Fractional font sizes (e.g. 19.52px) cause fractional half-leading:
      // (lineHeight - fontSize) / 2 = e.g. 1.74px per side, which the browser
      // rounds inconsistently, inflating each line by ~0.5px. layoutPages()
      // budgets N × lineHeight for a text slice, but the browser paints
      // N × (lineHeight + 0.5), so over a full page content overflows the
      // page boundary by roughly half a line.
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
