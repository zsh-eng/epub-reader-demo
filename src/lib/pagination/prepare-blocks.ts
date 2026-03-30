import { layoutNextLine, prepareWithSegments } from "@chenglou/pretext";
import type {
  Block,
  FontConfig,
  InlineRun,
  PreparedBlock,
  PreparedInlineItem,
  PreparedTextBlock,
} from "./types";
import { headingScale, CODE_CHROME_PX } from "./spacing";
import { LINE_START_CURSOR, measureCollapsedSpaceWidth } from "./measure";

const UNBOUNDED_WIDTH = 100_000;

function resolveFont(run: InlineRun, tag: string, fonts: FontConfig): string {
  const scale = headingScale(tag);
  const isHeading = scale > 1;

  let family: string;
  let sizePx: number;

  if (run.isCode) {
    family = fonts.codeFamily;
    sizePx = Math.max(11, fonts.baseSizePx * scale * 0.92);
  } else if (isHeading) {
    family = fonts.headingFamily;
    sizePx = fonts.baseSizePx * scale;
  } else {
    family = fonts.bodyFamily;
    sizePx = fonts.baseSizePx * scale;
  }

  const weight = run.bold ? 700 : isHeading ? 600 : 400;
  const style = run.italic ? "italic " : "";

  return `${style}${weight} ${Math.round(sizePx * 100) / 100}px ${family}`;
}

function prepareTextBlock(
  block: Extract<Block, { type: "text" }>,
  fonts: FontConfig,
): PreparedTextBlock {
  const items: PreparedInlineItem[] = [];
  let pendingGap = 0;
  let containsNewlines = block.tag === "pre";

  for (const run of block.runs) {
    if (run.text.includes("\n")) containsNewlines = true;

    const carryGap = pendingGap;
    const hasLeadingWhitespace = /^\s/.test(run.text);
    const hasTrailingWhitespace = /\s$/.test(run.text);
    const trimmedText = run.text.trim();

    const font = resolveFont(run, block.tag, fonts);
    pendingGap = hasTrailingWhitespace ? measureCollapsedSpaceWidth(font) : 0;

    if (!trimmedText) continue;

    const prepared = prepareWithSegments(trimmedText, font);
    const wholeLine = layoutNextLine(
      prepared,
      LINE_START_CURSOR,
      UNBOUNDED_WIDTH,
    );
    if (!wholeLine) continue;

    items.push({
      kind: "text",
      font,
      isLink: run.isLink,
      isCode: run.isCode,
      chromeWidth: run.isCode ? CODE_CHROME_PX : 0,
      prepared,
      fullText: wholeLine.text,
      fullWidth: wholeLine.width,
      endCursor: wholeLine.end,
      leadingGap:
        carryGap > 0 || hasLeadingWhitespace
          ? measureCollapsedSpaceWidth(font)
          : 0,
    });
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
      case "text":
        result.push(prepareTextBlock(block, fonts));
        break;
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

export { clearMeasureCache as clearPrepareCache } from "./measure";
