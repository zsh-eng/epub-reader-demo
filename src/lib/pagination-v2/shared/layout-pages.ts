import { layoutPreWrapLines, layoutTextLines } from "./layout-text-lines";
import {
    getBlockInsetLeft,
    getBlockSpacing,
    getCollapsedBlockGap,
    getLineHeight,
} from "./spacing";
import type {
    LayoutTheme,
    Page,
    PaginationResult,
    PreparedBlock,
    PreparedTextBlock,
} from "./types";

const JUSTIFY_DISABLED_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
]);

function resolveTextAlignForBlock(
  textAlign: LayoutTheme["textAlign"],
  tag: PreparedTextBlock["tag"],
): LayoutTheme["textAlign"] {
  if (
    tag === "figcaption" &&
    (textAlign === "justify" || textAlign === "justify-knuth-plass")
  ) {
    return "left";
  }

  if (
    textAlign === "justify-knuth-plass" &&
    JUSTIFY_DISABLED_TAGS.has(tag)
  ) {
    return "justify";
  }

  return textAlign;
}

function createPage(index: number): Page & { usedHeight: number } {
  return { index, slices: [], usedHeight: 0 };
}

function fitImageToBounds(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const safeWidth = Math.max(1, maxWidth);
  const safeHeight = Math.max(1, maxHeight);
  const safeIntrinsicWidth = Math.max(1, width);
  const safeIntrinsicHeight = Math.max(1, height);
  const scale = Math.min(
    1,
    safeWidth / safeIntrinsicWidth,
    safeHeight / safeIntrinsicHeight,
  );

  return {
    width: safeIntrinsicWidth * scale,
    height: safeIntrinsicHeight * scale,
  };
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
  let previousBlockKind: PreparedTextBlock["tag"] | "image" | null = null;
  let totalLineCount = 0;

  const pushPage = () => {
    const { usedHeight: _, ...page } = current;
    pages.push(page);
    current = createPage(pages.length);
    prevMarginBelow = 0;
    previousBlockKind = null;
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
      previousBlockKind = null;
      continue;
    }

    if (block.type === "spacer") {
      addSpacer(block.id, theme.baseFontSizePx * 0.9);
      prevMarginBelow = 0;
      previousBlockKind = null;
      continue;
    }

    if (block.type === "image") {
      const spacing = getBlockSpacing("image", theme);
      const gap = getCollapsedBlockGap(
        previousBlockKind,
        "image",
        theme,
        prevMarginBelow,
      );
      const fittedImage = fitImageToBounds(
        block.intrinsicWidth,
        block.intrinsicHeight,
        safeWidth,
        safeHeight,
      );

      // Only emit the gap when there is already content on this page. Crucially,
      // check whether the image will overflow *before* emitting the spacer: if
      // the image won't fit (with or without the gap), push the page first and
      // drop the gap. Emitting the spacer then pushing would leave it stranded
      // on the previous page, separated from the image it belongs to.
      // This matches standard print layout — top-of-page margins are suppressed.
      if (current.slices.length > 0) {
        const available = safeHeight - current.usedHeight;
        if (gap + fittedImage.height <= available) {
          if (gap > 0) addSpacer(block.id, gap);
        } else {
          pushPage();
        }
      }

      let available = safeHeight - current.usedHeight;
      if (available <= 0) {
        pushPage();
        available = safeHeight;
      }
      const displaySize = fitImageToBounds(
        block.intrinsicWidth,
        block.intrinsicHeight,
        safeWidth,
        available,
      );

      current.slices.push({
        type: "image",
        blockId: block.id,
        src: block.src,
        alt: block.alt,
        width: displaySize.width,
        height: displaySize.height,
      });
      current.usedHeight += displaySize.height;

      prevMarginBelow = spacing.below;
      previousBlockKind = "image";
      continue;
    }

    // Text block
    const textBlock = block as PreparedTextBlock;
    const spacing = getBlockSpacing(textBlock.tag, theme);

    const textLayoutWidth = Math.max(
      1,
      safeWidth - getBlockInsetLeft(textBlock.tag, theme),
    );
    const textAlign = resolveTextAlignForBlock(theme.textAlign, textBlock.tag);
    const lineLayout = textBlock.containsNewlines
      ? {
          lines: layoutPreWrapLines(textBlock.items, textLayoutWidth),
          renderMode: "native" as const,
        }
      : layoutTextLines(textBlock.items, textLayoutWidth, { textAlign });
    const { lines, renderMode } = lineLayout;
    totalLineCount += lines.length;

    if (lines.length === 0) {
      continue;
    }

    // Margin collapsing
    const effectiveGap =
      current.slices.length === 0
        ? 0
        : getCollapsedBlockGap(
            previousBlockKind,
            textBlock.tag,
            theme,
            prevMarginBelow,
          );
    if (effectiveGap > 0) addSpacer(textBlock.id, effectiveGap);

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
        tag: textBlock.tag,
        lineHeight,
        textAlign,
        renderMode,
        lines: sliceLines,
      });
      current.usedHeight += take * lineHeight;
      lineIndex += take;
    }

    prevMarginBelow = spacing.below;
    previousBlockKind = textBlock.tag;
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
