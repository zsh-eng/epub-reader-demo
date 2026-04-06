import {
    layoutNextLine,
    prepareWithSegments,
    type LayoutCursor,
    type PreparedTextWithSegments,
} from "@chenglou/pretext";
import {
    clearMeasureCache,
    LINE_START_CURSOR,
    measureCollapsedSpaceWidth,
} from "./measure";
import { CODE_CHROME_PX, headingScale } from "./spacing";
import type {
    Block,
    FontConfig,
    InlineRun,
    PreparedBlock,
    PreparedInlineItem,
    PreparedTextBlock,
} from "./types";

const UNBOUNDED_WIDTH = 100_000;
const PREPARED_TEXT_CACHE_MAX = 12_000;

interface PreparedTextCacheEntry {
  prepared: PreparedTextWithSegments;
  fullText: string;
  fullWidth: number;
  endCursor: LayoutCursor;
}

const preparedTextCache = new Map<string, PreparedTextCacheEntry | null>();

function getPreparedText(
  text: string,
  font: string,
): PreparedTextCacheEntry | null {
  const cacheKey = `${font}\n${text}`;

  if (preparedTextCache.has(cacheKey)) {
    return preparedTextCache.get(cacheKey) ?? null;
  }

  const prepared = prepareWithSegments(text, font);
  const wholeLine = layoutNextLine(
    prepared,
    LINE_START_CURSOR,
    UNBOUNDED_WIDTH,
  );

  const cached =
    wholeLine === null
      ? null
      : {
          prepared,
          fullText: wholeLine.text,
          fullWidth: wholeLine.width,
          endCursor: wholeLine.end,
        };

  if (preparedTextCache.size >= PREPARED_TEXT_CACHE_MAX) {
    preparedTextCache.clear();
  }
  preparedTextCache.set(cacheKey, cached);
  return cached;
}

function resolveFont(run: InlineRun, tag: string, fonts: FontConfig): string {
  const scale = headingScale(tag);
  const isHeading = scale > 1;

  let family: string;
  let sizePx: number;

  // IMPORTANT:
  // Round to whole pixels so the browser's rendered line height matches
  // what our layout engine assumes during pagination.
  //
  // CSS "half-leading": when line-height > font-size, the browser splits
  // the difference in half and adds it above and below the glyph area:
  //   glyph area (font-size) sits in the middle
  //   half-leading above + glyph area + half-leading below = line box
  //
  // Fractional font sizes make this split land on sub-pixel values that
  // the browser rounds inconsistently. For example:
  //   font-size: 19.52px, line-height: 23px
  //   leading = 23 - 19.52 = 3.48px → 1.74px above + 1.74px below
  //   browser rounds each half to 2px → 2 + 19.52 + 2 = 23.52 → 23.5px
  //
  // layoutPages() budgets N × 23px for a text slice, but the browser
  // paints N × 23.5px, so over a full page content overflows the page
  // boundary by roughly half a line.
  if (run.isCode) {
    family = fonts.codeFamily;
    sizePx = Math.round(Math.max(11, fonts.baseSizePx * scale * 0.92));
  } else if (isHeading) {
    family = fonts.headingFamily;
    sizePx = Math.round(fonts.baseSizePx * scale);
  } else {
    family = fonts.bodyFamily;
    sizePx = Math.round(fonts.baseSizePx * scale);
  }

  const weight = run.bold ? 700 : isHeading ? 600 : 400;
  const style = run.italic || tag === "blockquote" ? "italic " : "";

  return `${style}${weight} ${Math.round(sizePx * 100) / 100}px ${family}`;
}

function prepareTextBlock(
  block: Extract<Block, { type: "text" }>,
  fonts: FontConfig,
): PreparedTextBlock | null {
  const items: PreparedInlineItem[] = [];
  const isPreformatted = block.tag === "pre";
  let pendingGap = 0;
  let containsNewlines = isPreformatted;

  for (const run of block.runs) {
    const carryGap = pendingGap;
    const sourceText = run.text.replace(/\u00a0/g, " ");
    const isHardBreak = !isPreformatted && run.hardBreak === true;
    const normalizedText =
      isPreformatted || isHardBreak
        ? sourceText
        : sourceText.replace(/\s+/g, " ");
    const hasLeadingWhitespace =
      !isPreformatted && !isHardBreak && /^\s/.test(sourceText);
    const hasTrailingWhitespace =
      !isPreformatted && !isHardBreak && /\s$/.test(sourceText);
    const preparedText =
      isPreformatted || isHardBreak ? normalizedText : normalizedText.trim();

    const font = resolveFont(run, block.tag, fonts);
    const needsCollapsedSpaceWidth =
      hasTrailingWhitespace || hasLeadingWhitespace || carryGap > 0;
    const collapsedSpaceWidth = needsCollapsedSpaceWidth
      ? measureCollapsedSpaceWidth(font)
      : 0;
    pendingGap = hasTrailingWhitespace ? collapsedSpaceWidth : 0;

    if (isHardBreak) containsNewlines = true;
    if (!preparedText) continue;

    const cached = getPreparedText(preparedText, font);
    if (!cached) continue;

    items.push({
      kind: "text",
      font,
      isLink: run.isLink,
      isCode: run.isCode,
      highlightMarks:
        run.highlightMarks && run.highlightMarks.length > 0
          ? [...run.highlightMarks]
          : undefined,
      chromeWidth: run.isCode ? CODE_CHROME_PX : 0,
      prepared: cached.prepared,
      rawText: preparedText,
      fullText: cached.fullText,
      fullWidth: cached.fullWidth,
      endCursor: cached.endCursor,
      leadingGap:
        carryGap > 0 || hasLeadingWhitespace ? collapsedSpaceWidth : 0,
    });
  }

  if (items.length === 0) {
    return null;
  }

  return {
    type: "text",
    id: block.id,
    tag: block.tag,
    items,
    containsNewlines,
  };
}

export function prepareBlocks(
  blocks: Block[],
  fonts: FontConfig,
): PreparedBlock[] {
  const result: PreparedBlock[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "text": {
        const preparedTextBlock = prepareTextBlock(block, fonts);
        if (preparedTextBlock) {
          result.push(preparedTextBlock);
        }
        break;
      }
      case "image":
        result.push({ ...block });
        break;
      case "spacer":
      case "page-break":
        result.push({ ...block });
        break;
    }
  }

  return result;
}

export function clearPrepareCache(): void {
  clearMeasureCache();
  preparedTextCache.clear();
}
