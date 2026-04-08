import type { LayoutCursor } from "@chenglou/pretext";
import {
  layoutNextLine,
  layoutWithLines,
  prepareWithSegments,
} from "@chenglou/pretext";
import {
  LINE_START_CURSOR,
  cursorsMatch,
  measureTextWidth,
} from "./measure";
import type {
  PageFragment,
  PageLine,
  PreparedInlineItem,
  TextCursorOffset,
  TextRenderMode,
} from "./types";

const HUGE_BADNESS = 1e8;
const SOFT_HYPHEN = "\u00AD";
const RIVER_THRESHOLD = 1.5;
const INFEASIBLE_SPACE_RATIO = 0.4;
const TIGHT_SPACE_RATIO = 0.65;

type TextLineLayoutResult = {
  lines: PageLine[];
  renderMode: TextRenderMode;
};

type InlineLayoutToken = {
  kind: "text" | "space" | "soft-hyphen";
  text: string;
  width: number;
  font: string;
  isLink: boolean;
  isCode: boolean;
  highlightMarks?: PageFragment["highlightMarks"];
  startOffset: TextCursorOffset;
  endOffset: TextCursorOffset;
};

type BreakCandidateKind = "start" | "space" | "soft-hyphen" | "end";

type BreakCandidate = {
  tokenIndex: number;
  kind: BreakCandidateKind;
  offset: TextCursorOffset;
};

type LineStats = {
  wordWidth: number;
  naturalWidth: number;
  spaceCount: number;
  normalSpaceWidth: number;
  trailingMarker: "none" | "soft-hyphen";
};

function createOffset(
  itemIndex: number,
  cursor: LayoutCursor,
): TextCursorOffset {
  return {
    itemIndex,
    segmentIndex: cursor.segmentIndex,
    graphemeIndex: cursor.graphemeIndex,
  };
}

export function layoutTextLines(
  items: PreparedInlineItem[],
  maxWidth: number,
  options?: { useOptimalJustify?: boolean },
): TextLineLayoutResult {
  const safeWidth = Math.max(1, maxWidth);

  if (options?.useOptimalJustify) {
    const optimalLines = layoutTextLinesOptimal(items, safeWidth);
    if (optimalLines !== null) {
      return {
        lines: optimalLines,
        renderMode: "manual-justify",
      };
    }
  }

  return {
    lines: layoutTextLinesGreedy(items, safeWidth),
    renderMode: "native",
  };
}

function layoutTextLinesGreedy(
  items: PreparedInlineItem[],
  safeWidth: number,
): PageLine[] {
  const lines: PageLine[] = [];

  let itemIndex = 0;
  let textCursor: LayoutCursor | null = null;

  while (itemIndex < items.length) {
    const fragments: PageLine["fragments"] = [];
    let remainingWidth = safeWidth;
    let lineStartOffset: TextCursorOffset | null = null;
    let lineEndOffset: TextCursorOffset | null = null;

    lineLoop: while (itemIndex < items.length) {
      const item = items[itemIndex];
      if (!item) break;

      if (item.kind === "atomic") {
        const leadingGap = fragments.length === 0 ? 0 : item.leadingGap;
        if (fragments.length > 0 && leadingGap + item.width > remainingWidth) {
          break lineLoop;
        }
        fragments.push({
          kind: "text",
          text: item.content.alt ?? "",
          font: "",
          leadingGap,
          isLink: false,
          isCode: false,
        });
        remainingWidth -= leadingGap + item.width;
        itemIndex++;
        continue;
      }

      // kind === 'text'
      if (textCursor && cursorsMatch(textCursor, item.endCursor)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      const leadingGap = fragments.length === 0 ? 0 : item.leadingGap;
      const reservedWidth = leadingGap + item.chromeWidth;

      if (fragments.length > 0 && reservedWidth >= remainingWidth) {
        break lineLoop;
      }

      // Fast path: whole run fits
      if (!textCursor) {
        const fullWidth = leadingGap + item.fullWidth + item.chromeWidth;
        if (fullWidth <= remainingWidth) {
          if (!lineStartOffset) {
            lineStartOffset = createOffset(itemIndex, LINE_START_CURSOR);
          }
          lineEndOffset = createOffset(itemIndex, item.endCursor);

          fragments.push({
            kind: "text",
            text: item.fullText,
            font: item.font,
            leadingGap,
            isLink: item.isLink,
            isCode: item.isCode,
            highlightMarks: item.highlightMarks,
          });
          remainingWidth -= fullWidth;
          itemIndex++;
          continue;
        }
      }

      // Slow path: split via layoutNextLine
      const start = textCursor ?? LINE_START_CURSOR;
      const line = layoutNextLine(
        item.prepared,
        start,
        Math.max(1, remainingWidth - reservedWidth),
      );

      if (!line || cursorsMatch(start, line.end)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      if (!lineStartOffset) {
        lineStartOffset = createOffset(itemIndex, start);
      }
      lineEndOffset = createOffset(itemIndex, line.end);

      fragments.push({
        kind: "text",
        text: line.text,
        font: item.font,
        leadingGap,
        isLink: item.isLink,
        isCode: item.isCode,
        highlightMarks: item.highlightMarks,
      });
      remainingWidth -= leadingGap + line.width + item.chromeWidth;

      if (cursorsMatch(line.end, item.endCursor)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      textCursor = line.end;
      break lineLoop;
    }

    if (fragments.length === 0) break;
    lines.push({
      fragments,
      startOffset: lineStartOffset ?? undefined,
      endOffset: lineEndOffset ?? undefined,
      isLastInBlock: false,
    });
  }

  return lines;
}

function canUseOptimalJustify(items: PreparedInlineItem[]): boolean {
  return (
    items.length > 0 &&
    items.every((item) => item.kind === "text" && item.chromeWidth === 0)
  );
}

function layoutTextLinesOptimal(
  items: PreparedInlineItem[],
  maxWidth: number,
): PageLine[] | null {
  if (!canUseOptimalJustify(items)) return null;

  const tokens = flattenInlineTokens(items);
  if (tokens.length === 0) return [];

  const firstOffset = tokens[0]?.startOffset;
  const lastOffset = tokens[tokens.length - 1]?.endOffset;
  if (!firstOffset || !lastOffset) return null;

  const breakCandidates: BreakCandidate[] = [
    {
      tokenIndex: 0,
      kind: "start",
      offset: firstOffset,
    },
  ];

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    if (!token) continue;

    if (
      token.kind === "space" &&
      tokenIndex + 1 < tokens.length &&
      tokens[tokenIndex + 1]
    ) {
      breakCandidates.push({
        tokenIndex: tokenIndex + 1,
        kind: "space",
        offset: tokens[tokenIndex + 1]!.startOffset,
      });
      continue;
    }

    if (token.kind === "soft-hyphen" && tokenIndex + 1 < tokens.length) {
      breakCandidates.push({
        tokenIndex: tokenIndex + 1,
        kind: "soft-hyphen",
        offset: token.endOffset,
      });
    }
  }

  breakCandidates.push({
    tokenIndex: tokens.length,
    kind: "end",
    offset: lastOffset,
  });

  const dp: number[] = new Array(breakCandidates.length).fill(Infinity);
  const previous: number[] = new Array(breakCandidates.length).fill(-1);
  dp[0] = 0;

  for (let toCandidate = 1; toCandidate < breakCandidates.length; toCandidate++) {
    const candidate = breakCandidates[toCandidate];
    if (!candidate) continue;

    const isLastLine = candidate.kind === "end";

    for (
      let fromCandidate = toCandidate - 1;
      fromCandidate >= 0;
      fromCandidate--
    ) {
      if (dp[fromCandidate] === Infinity) continue;

      const lineStats = getLineStats(
        tokens,
        breakCandidates,
        fromCandidate,
        toCandidate,
      );
      if (lineStats === null) continue;

      if (lineStats.naturalWidth > maxWidth * 2) break;

      const totalBadness =
        dp[fromCandidate]! +
        lineBadness(lineStats, maxWidth, isLastLine);

      if (totalBadness < dp[toCandidate]!) {
        dp[toCandidate] = totalBadness;
        previous[toCandidate] = fromCandidate;
      }
    }
  }

  if (previous[breakCandidates.length - 1] === -1) {
    return null;
  }

  const chosenBreaks: number[] = [];
  let current = breakCandidates.length - 1;
  while (current > 0) {
    const prev = previous[current];
    if (prev === -1) return null;
    chosenBreaks.push(current);
    current = prev;
  }
  chosenBreaks.reverse();

  const lines: PageLine[] = [];
  let fromCandidate = 0;
  for (const toCandidate of chosenBreaks) {
    const line = buildOptimalLine(
      tokens,
      breakCandidates,
      fromCandidate,
      toCandidate,
      maxWidth,
    );
    if (line === null) return null;
    lines.push(line);
    fromCandidate = toCandidate;
  }

  return lines;
}

function flattenInlineTokens(items: PreparedInlineItem[]): InlineLayoutToken[] {
  const tokens: InlineLayoutToken[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    if (!item || item.kind !== "text") {
      return [];
    }

    if (tokens.length > 0 && item.leadingGap > 0) {
      const itemStartOffset = createOffset(itemIndex, LINE_START_CURSOR);
      tokens.push({
        kind: "space",
        text: " ",
        width: item.leadingGap,
        font: item.font,
        isLink: item.isLink,
        isCode: item.isCode,
        highlightMarks: item.highlightMarks,
        startOffset: itemStartOffset,
        endOffset: itemStartOffset,
      });
    }

    for (let segIndex = 0; segIndex < item.prepared.segments.length; segIndex++) {
      const text = item.prepared.segments[segIndex];
      const width = item.prepared.widths[segIndex];
      if (text === undefined || width === undefined) continue;

      const startOffset = createOffset(itemIndex, {
        segmentIndex: segIndex,
        graphemeIndex: 0,
      });
      const endOffset = createOffset(itemIndex, {
        segmentIndex: segIndex + 1,
        graphemeIndex: 0,
      });

      if (text === SOFT_HYPHEN) {
        tokens.push({
          kind: "soft-hyphen",
          text,
          width: 0,
          font: item.font,
          isLink: item.isLink,
          isCode: item.isCode,
          highlightMarks: item.highlightMarks,
          startOffset,
          endOffset,
        });
        continue;
      }

      tokens.push({
        kind: isSpaceText(text) ? "space" : "text",
        text,
        width,
        font: item.font,
        isLink: item.isLink,
        isCode: item.isCode,
        highlightMarks: item.highlightMarks,
        startOffset,
        endOffset,
      });
    }
  }

  return tokens;
}

function getLineStats(
  tokens: readonly InlineLayoutToken[],
  breakCandidates: readonly BreakCandidate[],
  fromCandidate: number,
  toCandidate: number,
): LineStats | null {
  const from = breakCandidates[fromCandidate]?.tokenIndex;
  const to = breakCandidates[toCandidate]?.tokenIndex;
  const breakKind = breakCandidates[toCandidate]?.kind;
  if (from === undefined || to === undefined || breakKind === undefined) {
    return null;
  }

  let wordWidth = 0;
  let naturalWidth = 0;
  let spaceCount = 0;

  for (let tokenIndex = from; tokenIndex < to; tokenIndex++) {
    const token = tokens[tokenIndex];
    if (!token || token.kind === "soft-hyphen") continue;

    naturalWidth += token.width;
    if (token.kind === "space") {
      spaceCount += 1;
      continue;
    }

    wordWidth += token.width;
  }

  const trailingToken = to > from ? tokens[to - 1] : null;
  if (trailingToken?.kind === "space") {
    naturalWidth -= trailingToken.width;
    spaceCount -= 1;
  }

  const hyphenWidth =
    breakKind === "soft-hyphen"
      ? measureTextWidth("-", tokens[to - 1]?.font ?? "")
      : 0;
  const normalSpaceWidth =
    spaceCount > 0 ? (naturalWidth - wordWidth) / spaceCount : 0;

  return {
    wordWidth: wordWidth + hyphenWidth,
    naturalWidth: naturalWidth + hyphenWidth,
    spaceCount: Math.max(0, spaceCount),
    normalSpaceWidth: Math.max(0, normalSpaceWidth),
    trailingMarker: breakKind === "soft-hyphen" ? "soft-hyphen" : "none",
  };
}

function lineBadness(
  lineStats: LineStats,
  maxWidth: number,
  isLastLine: boolean,
): number {
  if (isLastLine) {
    if (lineStats.wordWidth > maxWidth) return HUGE_BADNESS;
    return 0;
  }

  if (lineStats.spaceCount <= 0) {
    const slack = maxWidth - lineStats.wordWidth;
    if (slack < 0) return HUGE_BADNESS;
    return slack * slack * 10;
  }

  const justifiedSpace = (maxWidth - lineStats.wordWidth) / lineStats.spaceCount;
  if (justifiedSpace < 0) return HUGE_BADNESS;
  const normalSpaceWidth = lineStats.normalSpaceWidth || justifiedSpace;
  if (normalSpaceWidth <= 0) return HUGE_BADNESS;

  if (justifiedSpace < normalSpaceWidth * INFEASIBLE_SPACE_RATIO) {
    return HUGE_BADNESS;
  }

  const ratio = (justifiedSpace - normalSpaceWidth) / normalSpaceWidth;
  const absRatio = Math.abs(ratio);
  const badness = absRatio * absRatio * absRatio * 1000;

  const riverExcess = justifiedSpace / normalSpaceWidth - RIVER_THRESHOLD;
  const riverPenalty =
    riverExcess > 0 ? 5000 + riverExcess * riverExcess * 10000 : 0;

  const tightThreshold = normalSpaceWidth * TIGHT_SPACE_RATIO;
  const tightPenalty =
    justifiedSpace < tightThreshold
      ? 3000 + (tightThreshold - justifiedSpace) ** 2 * 10000
      : 0;

  const hyphenPenalty = lineStats.trailingMarker === "soft-hyphen" ? 50 : 0;
  return badness + riverPenalty + tightPenalty + hyphenPenalty;
}

function buildOptimalLine(
  tokens: readonly InlineLayoutToken[],
  breakCandidates: readonly BreakCandidate[],
  fromCandidate: number,
  toCandidate: number,
  maxWidth: number,
): PageLine | null {
  const from = breakCandidates[fromCandidate]?.tokenIndex;
  const to = breakCandidates[toCandidate]?.tokenIndex;
  const breakKind = breakCandidates[toCandidate]?.kind;
  const startOffset = breakCandidates[fromCandidate]?.offset;
  const endOffset = breakCandidates[toCandidate]?.offset;
  if (
    from === undefined ||
    to === undefined ||
    breakKind === undefined ||
    !startOffset ||
    !endOffset
  ) {
    return null;
  }

  const lineStats = getLineStats(tokens, breakCandidates, fromCandidate, toCandidate);
  if (lineStats === null) return null;

  const fragments: PageFragment[] = [];
  const isLastLine = breakKind === "end";
  const targetSpaceWidth =
    !isLastLine && lineStats.spaceCount > 0
      ? (maxWidth - lineStats.wordWidth) / lineStats.spaceCount
      : null;
  const wordSpacingPx =
    targetSpaceWidth !== null
      ? targetSpaceWidth - lineStats.normalSpaceWidth
      : undefined;
  const trailingFillPx =
    !isLastLine && lineStats.spaceCount <= 0
      ? Math.max(0, maxWidth - lineStats.wordWidth)
      : 0;

  let lastRenderableFragment: PageFragment | null = null;
  for (let tokenIndex = from; tokenIndex < to; tokenIndex++) {
    const token = tokens[tokenIndex];
    if (!token || token.kind === "soft-hyphen") continue;

    const fragment: PageFragment = {
      kind: token.kind === "space" ? "space" : "text",
      text: token.kind === "space" ? " " : token.text,
      font: token.font,
      leadingGap: 0,
      isLink: token.isLink,
      isCode: token.isCode,
      highlightMarks: token.highlightMarks,
    };

    fragments.push(fragment);
    lastRenderableFragment = fragment;
  }

  if (breakKind === "soft-hyphen") {
    const softHyphenToken = tokens[to - 1];
    fragments.push({
      kind: "text",
      text: "-",
      font: softHyphenToken?.font ?? "",
      leadingGap: 0,
      isLink: softHyphenToken?.isLink ?? false,
      isCode: softHyphenToken?.isCode ?? false,
      highlightMarks: softHyphenToken?.highlightMarks,
    });
    lastRenderableFragment = fragments[fragments.length - 1] ?? lastRenderableFragment;
  }

  if (trailingFillPx > 0 && lastRenderableFragment) {
    lastRenderableFragment.marginRightPx = trailingFillPx;
  }

  return {
    fragments,
    startOffset,
    endOffset,
    isLastInBlock: false,
    wordSpacingPx,
  };
}

export function layoutPreWrapLines(
  items: PreparedInlineItem[],
  maxWidth: number,
): PageLine[] {
  if (items.length === 0) return [];

  const firstText = items.find((i) => i.kind === "text");
  if (!firstText || firstText.kind !== "text") return [];

  const combinedText = items
    .map((i) => (i.kind === "text" ? i.rawText : ""))
    .join("");
  const font = firstText.font;

  const prepared = prepareWithSegments(combinedText, font, {
    whiteSpace: "pre-wrap",
  });
  const result = layoutWithLines(prepared, Math.max(1, maxWidth), 1);

  return result.lines.map((line) => ({
    fragments: [
      {
        kind: "text",
        text: line.text,
        font,
        leadingGap: 0,
        isLink: firstText.isLink,
        isCode: true,
        highlightMarks: firstText.highlightMarks,
      },
    ],
    startOffset: createOffset(0, line.start),
    endOffset: createOffset(0, line.end),
    isLastInBlock: false,
  }));
}

function isSpaceText(text: string): boolean {
  return text.trim().length === 0;
}
