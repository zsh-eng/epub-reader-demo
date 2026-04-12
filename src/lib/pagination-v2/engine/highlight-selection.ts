import type {
    Block,
    PreparedBlock,
    PreparedTextBlock,
    PreparedTextItem,
    TextBlock,
    TextCursorOffset,
    TextRun,
} from "../shared/types";
import type { ContentAnchor } from "../types";

const DEFAULT_CONTEXT_LENGTH = 50;

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export interface ResolvedHighlightSelection {
  chapterIndex: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  textBefore: string;
  textAfter: string;
}

function isTextBlock(block: Block): block is TextBlock {
  return block.type === "text";
}

function getSegmentGraphemes(text: string): string[] {
  if (!graphemeSegmenter) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment);
}

function getPersistedRunText(blockTag: TextBlock["tag"], run: TextRun): string {
  return !run.hardBreak || blockTag === "pre" ? run.text : "";
}

function getTextBlockContent(block: TextBlock): string {
  return block.runs.map((run) => getPersistedRunText(block.tag, run)).join("");
}

function getBlockTextContent(block: Block): string {
  return isTextBlock(block) ? getTextBlockContent(block) : "";
}

function findPreparedTextBlock(
  preparedChapter: PreparedBlock[],
  blockId: string,
): PreparedTextBlock | null {
  for (const block of preparedChapter) {
    if (block.type === "text" && block.id === blockId) {
      return block;
    }
  }

  return null;
}

function normalizeRunText(
  blockTag: TextBlock["tag"],
  run: TextRun,
): {
  sourceText: string;
  preparedText: string;
  isPreformatted: boolean;
  isHardBreak: boolean;
} {
  const isPreformatted = blockTag === "pre";
  const sourceText = getPersistedRunText(blockTag, run).replace(/\u00a0/g, " ");
  const isHardBreak = !isPreformatted && run.hardBreak === true;
  const normalizedText =
    isPreformatted || isHardBreak
      ? run.text.replace(/\u00a0/g, " ")
      : sourceText.replace(/\s+/g, " ");
  const preparedText =
    isPreformatted || isHardBreak ? normalizedText : normalizedText.trim();

  return {
    sourceText,
    preparedText,
    isPreformatted,
    isHardBreak,
  };
}

function getPreparedBoundaryIndex(
  item: PreparedTextItem,
  cursor: TextCursorOffset,
): number | null {
  if (cursor.itemIndex < 0 || cursor.segmentIndex < 0 || cursor.graphemeIndex < 0) {
    return null;
  }

  let boundaryIndex = 0;

  for (
    let segmentIndex = 0;
    segmentIndex < item.prepared.segments.length;
    segmentIndex++
  ) {
    const segment = item.prepared.segments[segmentIndex];
    if (segment === undefined) continue;

    if (segmentIndex < cursor.segmentIndex) {
      boundaryIndex += segment.length;
      continue;
    }

    if (segmentIndex > cursor.segmentIndex) {
      break;
    }

    const graphemes = getSegmentGraphemes(segment);
    const graphemeCount = Math.min(cursor.graphemeIndex, graphemes.length);
    for (let index = 0; index < graphemeCount; index++) {
      boundaryIndex += graphemes[index]?.length ?? 0;
    }
    return boundaryIndex;
  }

  if (cursor.segmentIndex === item.prepared.segments.length) {
    return boundaryIndex;
  }

  return null;
}

function buildCollapsedBoundaryMap(sourceText: string): number[] {
  const boundaries: number[] = [];
  const length = sourceText.length;
  let sourceIndex = 0;

  while (sourceIndex < length && /\s/.test(sourceText[sourceIndex] ?? "")) {
    sourceIndex += 1;
  }

  boundaries.push(sourceIndex);

  while (sourceIndex < length) {
    const char = sourceText[sourceIndex] ?? "";
    if (!/\s/.test(char)) {
      sourceIndex += 1;
      boundaries.push(sourceIndex);
      continue;
    }

    while (sourceIndex < length && /\s/.test(sourceText[sourceIndex] ?? "")) {
      sourceIndex += 1;
    }
    if (sourceIndex >= length) break;

    boundaries.push(sourceIndex);
  }

  return boundaries;
}

function resolvePreparedBoundaryToSourceOffset(options: {
  sourceText: string;
  preparedText: string;
  normalizedBoundaryIndex: number;
  isPreformatted: boolean;
  isHardBreak: boolean;
}): number {
  const {
    sourceText,
    preparedText,
    normalizedBoundaryIndex,
    isPreformatted,
    isHardBreak,
  } = options;

  const clampedBoundary = Math.max(
    0,
    Math.min(normalizedBoundaryIndex, preparedText.length),
  );

  if (isPreformatted || isHardBreak) {
    return Math.min(clampedBoundary, sourceText.length);
  }

  const boundaries = buildCollapsedBoundaryMap(sourceText);
  const mappedBoundary =
    boundaries[Math.min(clampedBoundary, boundaries.length - 1)];

  return mappedBoundary ?? 0;
}

function resolveAnchorToBlockOffset(
  block: TextBlock,
  preparedBlock: PreparedTextBlock,
  cursor: TextCursorOffset,
): number | null {
  const targetItem = preparedBlock.items[cursor.itemIndex];
  if (!targetItem) return null;

  const normalizedBoundaryIndex = getPreparedBoundaryIndex(targetItem, cursor);
  if (normalizedBoundaryIndex === null) return null;

  let blockOffset = 0;
  let preparedItemIndex = 0;

  for (const run of block.runs) {
    const { sourceText, preparedText, isPreformatted, isHardBreak } =
      normalizeRunText(block.tag, run);

    if (!preparedText) {
      blockOffset += getPersistedRunText(block.tag, run).length;
      continue;
    }

    if (preparedItemIndex === cursor.itemIndex) {
      const sourceOffset = resolvePreparedBoundaryToSourceOffset({
        sourceText,
        preparedText,
        normalizedBoundaryIndex,
        isPreformatted,
        isHardBreak,
      });
      return blockOffset + sourceOffset;
    }

    preparedItemIndex += 1;
    blockOffset += getPersistedRunText(block.tag, run).length;
  }

  return null;
}

function resolveTextAnchorToChapterOffset(options: {
  anchor: ContentAnchor;
  chapterBlocks: Block[];
  preparedChapter: PreparedBlock[];
}): number | null {
  const { anchor, chapterBlocks, preparedChapter } = options;

  if (anchor.type !== "text") return null;

  let chapterOffset = 0;

  for (const block of chapterBlocks) {
    if (!isTextBlock(block)) {
      chapterOffset += getBlockTextContent(block).length;
      continue;
    }

    if (block.id !== anchor.blockId) {
      chapterOffset += getTextBlockContent(block).length;
      continue;
    }

    const preparedBlock = findPreparedTextBlock(preparedChapter, block.id);
    if (!preparedBlock) return null;

    const blockOffset = resolveAnchorToBlockOffset(
      block,
      preparedBlock,
      anchor.offset,
    );
    if (blockOffset === null) return null;

    return chapterOffset + blockOffset;
  }

  return null;
}

export function resolveContentAnchorRangeToHighlight(options: {
  startAnchor: ContentAnchor;
  endAnchor: ContentAnchor;
  chapterBlocks: Block[];
  preparedChapter: PreparedBlock[];
  contextLength?: number;
}): ResolvedHighlightSelection | null {
  const {
    startAnchor,
    endAnchor,
    chapterBlocks,
    preparedChapter,
    contextLength = DEFAULT_CONTEXT_LENGTH,
  } = options;

  if (startAnchor.type !== "text" || endAnchor.type !== "text") {
    return null;
  }

  if (startAnchor.chapterIndex !== endAnchor.chapterIndex) {
    return null;
  }

  const startOffset = resolveTextAnchorToChapterOffset({
    anchor: startAnchor,
    chapterBlocks,
    preparedChapter,
  });
  const endOffset = resolveTextAnchorToChapterOffset({
    anchor: endAnchor,
    chapterBlocks,
    preparedChapter,
  });

  if (startOffset === null || endOffset === null) return null;

  const rangeStart = Math.min(startOffset, endOffset);
  const rangeEnd = Math.max(startOffset, endOffset);
  if (rangeStart === rangeEnd) return null;

  const fullText = chapterBlocks.map((block) => getBlockTextContent(block)).join("");
  const selectedText = fullText.slice(rangeStart, rangeEnd).trim();
  if (!selectedText) return null;

  return {
    chapterIndex: startAnchor.chapterIndex,
    startOffset: rangeStart,
    endOffset: rangeEnd,
    selectedText,
    textBefore: fullText.substring(
      Math.max(0, rangeStart - contextLength),
      rangeStart,
    ),
    textAfter: fullText.substring(
      rangeEnd,
      Math.min(fullText.length, rangeEnd + contextLength),
    ),
  };
}
