import {
  layoutNextLine,
  layoutWithLines,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";

type WhiteSpaceMode = "normal" | "pre-wrap";

export interface PaginationInlineRun {
  text: string;
  font: string;
  isLink?: boolean;
  isCode?: boolean;
}

export interface PaginationTextBlock {
  id: string;
  type: "text";
  runs: PaginationInlineRun[];
  lineHeight: number;
  marginTop: number;
  marginBottom: number;
  textAlign: "left" | "center" | "right" | "justify";
  whiteSpace?: WhiteSpaceMode;
}

export interface PaginationImageBlock {
  id: string;
  type: "image";
  src: string;
  alt?: string;
  width: number;
  height: number;
  marginTop: number;
  marginBottom: number;
}

export interface PaginationSpacerBlock {
  id: string;
  type: "spacer";
  height: number;
}

export type PaginationBlock =
  | PaginationTextBlock
  | PaginationImageBlock
  | PaginationSpacerBlock;

export interface PageTextFragment {
  text: string;
  font: string;
  leadingGap: number;
  isLink: boolean;
  isCode: boolean;
}

export interface PageTextLine {
  fragments: PageTextFragment[];
}

export interface PageTextSlice {
  id: string;
  type: "text";
  blockId: string;
  lineHeight: number;
  textAlign: PaginationTextBlock["textAlign"];
  lines: PageTextLine[];
}

export interface PageImageSlice {
  id: string;
  type: "image";
  blockId: string;
  src: string;
  alt?: string;
  width: number;
  height: number;
}

export interface PageSpacerSlice {
  id: string;
  type: "spacer";
  blockId: string;
  height: number;
}

export type PageSlice = PageTextSlice | PageImageSlice | PageSpacerSlice;

export interface PaginationPage {
  index: number;
  usedHeight: number;
  slices: PageSlice[];
}

export interface PaginationDiagnostics {
  blockCount: number;
  lineCount: number;
  recomputeMs: number;
}

export interface PaginationResult {
  totalPages: number;
  pages: PaginationPage[];
  diagnostics: PaginationDiagnostics;
}

export interface ChapterTypography {
  baseFontSizePx: number;
  baseLineHeight: number;
  textAlign: PaginationTextBlock["textAlign"];
  bodyFontFamily: string;
  headingFontFamily: string;
  codeFontFamily: string;
}

interface BlockSpacing {
  marginTop: number;
  marginBottom: number;
}

interface InlineStyleContext {
  fontSizePx: number;
  fontWeight: number;
  italic: boolean;
  fontFamily: string;
  codeFontFamily: string;
  isLink: boolean;
  isCode: boolean;
}

interface PaginationInput {
  blocks: PaginationBlock[];
  pageWidth: number;
  pageHeight: number;
}

interface PreparedRunItem {
  font: string;
  isLink: boolean;
  isCode: boolean;
  prepared: PreparedTextWithSegments;
  fullText: string;
  fullWidth: number;
  endCursor: LayoutCursor;
  leadingGap: number;
}

const LINE_START_CURSOR: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
const UNBOUNDED_WIDTH = 100_000;
const collapsedSpaceWidthCache = new Map<string, number>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cursorsMatch(a: LayoutCursor, b: LayoutCursor): boolean {
  return a.segmentIndex === b.segmentIndex && a.graphemeIndex === b.graphemeIndex;
}

function asFontString(
  family: string,
  sizePx: number,
  weight: number = 400,
  italic: boolean = false,
): string {
  const style = italic ? "italic " : "";
  return `${style}${weight} ${Math.round(sizePx * 100) / 100}px ${family}`;
}

function measureSingleLineWidth(prepared: PreparedTextWithSegments): number {
  const line = layoutNextLine(prepared, LINE_START_CURSOR, UNBOUNDED_WIDTH);
  return line?.width ?? 0;
}

function measureCollapsedSpaceWidth(font: string): number {
  const cached = collapsedSpaceWidthCache.get(font);
  if (cached !== undefined) return cached;

  const joined = measureSingleLineWidth(prepareWithSegments("A A", font));
  const compact = measureSingleLineWidth(prepareWithSegments("AA", font));
  const width = Math.max(0, joined - compact);
  collapsedSpaceWidthCache.set(font, width);
  return width;
}

function getBlockSpacing(tagName: string, baseFontSize: number): BlockSpacing {
  const rhythm = baseFontSize;
  switch (tagName) {
    case "h1":
      return { marginTop: rhythm * 1.75, marginBottom: rhythm * 0.75 };
    case "h2":
      return { marginTop: rhythm * 1.5, marginBottom: rhythm * 0.7 };
    case "h3":
      return { marginTop: rhythm * 1.4, marginBottom: rhythm * 0.65 };
    case "h4":
    case "h5":
    case "h6":
      return { marginTop: rhythm * 1.3, marginBottom: rhythm * 0.6 };
    case "li":
      return { marginTop: 0, marginBottom: rhythm * 0.45 };
    case "blockquote":
      return { marginTop: rhythm * 1.0, marginBottom: rhythm * 1.0 };
    case "pre":
      return { marginTop: rhythm * 1.0, marginBottom: rhythm * 1.0 };
    default:
      return { marginTop: 0, marginBottom: rhythm * 1.2 };
  }
}

function getHeadingScale(tagName: string): number {
  switch (tagName) {
    case "h1":
      return 2;
    case "h2":
      return 1.5;
    case "h3":
      return 1.25;
    case "h4":
      return 1.1;
    default:
      return 1;
  }
}

function parseNumericAttribute(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createBaseInlineContext(
  typography: ChapterTypography,
  tagName: string,
): InlineStyleContext {
  const headingScale = getHeadingScale(tagName);
  return {
    fontSizePx: typography.baseFontSizePx * headingScale,
    fontWeight: headingScale > 1 ? 600 : 400,
    italic: false,
    fontFamily: headingScale > 1 ? typography.headingFontFamily : typography.bodyFontFamily,
    codeFontFamily: typography.codeFontFamily,
    isLink: false,
    isCode: false,
  };
}

function toInlineRun(text: string, ctx: InlineStyleContext): PaginationInlineRun {
  return {
    text,
    font: asFontString(ctx.fontFamily, ctx.fontSizePx, ctx.fontWeight, ctx.italic),
    isLink: ctx.isLink,
    isCode: ctx.isCode,
  };
}

function appendRun(runs: PaginationInlineRun[], run: PaginationInlineRun): void {
  if (!run.text) return;
  const previous = runs[runs.length - 1];
  if (
    previous &&
    previous.font === run.font &&
    previous.isLink === run.isLink &&
    previous.isCode === run.isCode
  ) {
    previous.text += run.text;
    return;
  }
  runs.push(run);
}

function extractInlineRuns(
  node: Node,
  context: InlineStyleContext,
  output: PaginationInlineRun[],
  state: { hasHardBreak: boolean },
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    appendRun(output, toInlineRun(node.textContent ?? "", context));
    return;
  }

  if (!(node instanceof HTMLElement)) {
    return;
  }

  const tagName = node.tagName.toLowerCase();
  if (tagName === "script" || tagName === "style" || tagName === "noscript") {
    return;
  }

  if (tagName === "br") {
    state.hasHardBreak = true;
    appendRun(output, toInlineRun("\n", context));
    return;
  }

  const nextContext: InlineStyleContext = { ...context };
  if (tagName === "strong" || tagName === "b") {
    nextContext.fontWeight = Math.max(nextContext.fontWeight, 700);
  }
  if (tagName === "em" || tagName === "i") {
    nextContext.italic = true;
  }
  if (tagName === "a") {
    nextContext.isLink = true;
  }
  if (tagName === "code" || tagName === "kbd" || tagName === "samp") {
    nextContext.isCode = true;
    nextContext.fontFamily = context.isCode
      ? nextContext.fontFamily
      : nextContext.codeFontFamily;
    nextContext.fontSizePx = Math.max(11, nextContext.fontSizePx * 0.92);
  }
  if (tagName === "small") {
    nextContext.fontSizePx = Math.max(11, nextContext.fontSizePx * 0.9);
  }

  for (const child of Array.from(node.childNodes)) {
    extractInlineRuns(child, nextContext, output, state);
  }
}

function createTextBlockFromElement(
  element: HTMLElement,
  typography: ChapterTypography,
  blockId: string,
): PaginationTextBlock | null {
  const tagName = element.tagName.toLowerCase();
  const context = createBaseInlineContext(typography, tagName);
  const runs: PaginationInlineRun[] = [];
  const state = { hasHardBreak: false };

  for (const child of Array.from(element.childNodes)) {
    extractInlineRuns(child, context, runs, state);
  }

  const normalizedRuns = runs.filter((run) => run.text.length > 0);
  const combinedText = normalizedRuns.map((run) => run.text).join("");
  if (!combinedText.trim()) {
    return null;
  }

  const spacing = getBlockSpacing(tagName, typography.baseFontSizePx);
  const headingScale = getHeadingScale(tagName);
  const lineHeight = Math.max(
    typography.baseLineHeight * headingScale,
    typography.baseFontSizePx * headingScale * 1.2,
  );

  return {
    id: blockId,
    type: "text",
    runs: normalizedRuns,
    lineHeight,
    marginTop: spacing.marginTop,
    marginBottom: spacing.marginBottom,
    textAlign: typography.textAlign,
    whiteSpace: state.hasHardBreak || tagName === "pre" ? "pre-wrap" : "normal",
  };
}

function createImageBlockFromElement(
  element: HTMLImageElement,
  blockId: string,
  pageWidth: number,
  typography: ChapterTypography,
): PaginationImageBlock | null {
  const src = element.getAttribute("src");
  if (!src) return null;

  const rawWidth = parseNumericAttribute(element.getAttribute("width"));
  const rawHeight = parseNumericAttribute(element.getAttribute("height"));

  const maxWidth = Math.max(140, pageWidth * 0.9);
  const width = clamp(rawWidth ?? maxWidth, 140, maxWidth);
  const ratio =
    rawWidth && rawHeight && rawWidth > 0
      ? rawHeight / rawWidth
      : 3 / 4;
  const height = Math.max(80, width * ratio);

  return {
    id: blockId,
    type: "image",
    src,
    alt: element.getAttribute("alt") || undefined,
    width,
    height,
    marginTop: typography.baseFontSizePx * 1.2,
    marginBottom: typography.baseFontSizePx * 1.2,
  };
}

function walkNodeToBlocks(
  node: Node,
  blocks: PaginationBlock[],
  typography: ChapterTypography,
  pageWidth: number,
  idRef: { value: number },
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (!text.trim()) return;

    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    const block = createTextBlockFromElement(
      paragraph,
      typography,
      `text-${idRef.value++}`,
    );
    if (block) blocks.push(block);
    return;
  }

  if (!(node instanceof HTMLElement)) return;

  const tagName = node.tagName.toLowerCase();
  if (
    tagName === "script" ||
    tagName === "style" ||
    tagName === "noscript" ||
    tagName === "template"
  ) {
    return;
  }

  if (tagName === "img") {
    const imageBlock = createImageBlockFromElement(
      node as HTMLImageElement,
      `image-${idRef.value++}`,
      pageWidth,
      typography,
    );
    if (imageBlock) blocks.push(imageBlock);
    return;
  }

  if (tagName === "hr") {
    blocks.push({
      id: `spacer-${idRef.value++}`,
      type: "spacer",
      height: typography.baseFontSizePx * 0.9,
    });
    return;
  }

  const isTextBlockTag = [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "blockquote",
    "pre",
    "figcaption",
  ].includes(tagName);

  if (isTextBlockTag) {
    const block = createTextBlockFromElement(
      node,
      typography,
      `text-${idRef.value++}`,
    );
    if (block) blocks.push(block);
    return;
  }

  if (tagName === "table") {
    const fallback = document.createElement("p");
    fallback.textContent = node.textContent;
    const block = createTextBlockFromElement(
      fallback,
      typography,
      `text-${idRef.value++}`,
    );
    if (block) blocks.push(block);
    return;
  }

  for (const child of Array.from(node.childNodes)) {
    walkNodeToBlocks(child, blocks, typography, pageWidth, idRef);
  }
}

export function extractPaginationBlocksFromHtml(
  html: string,
  typography: ChapterTypography,
  pageWidth: number,
): PaginationBlock[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;
  const blocks: PaginationBlock[] = [];
  const idRef = { value: 1 };

  for (const node of Array.from(body.childNodes)) {
    walkNodeToBlocks(node, blocks, typography, pageWidth, idRef);
  }

  return blocks;
}

function prepareRunsForNormalLayout(runs: PaginationInlineRun[]): PreparedRunItem[] {
  const items: PreparedRunItem[] = [];
  let pendingGapByFont = new Map<string, number>();

  for (const run of runs) {
    const hasLeadingWhitespace = /^\s/.test(run.text);
    const hasTrailingWhitespace = /\s$/.test(run.text);
    const trimmedText = run.text.trim();
    const carryGap = pendingGapByFont.get(run.font) ?? 0;
    pendingGapByFont.clear();

    if (hasTrailingWhitespace) {
      pendingGapByFont.set(run.font, measureCollapsedSpaceWidth(run.font));
    }

    if (!trimmedText) continue;

    const prepared = prepareWithSegments(trimmedText, run.font, {
      whiteSpace: "normal",
    });
    const fullLine = layoutNextLine(prepared, LINE_START_CURSOR, UNBOUNDED_WIDTH);
    if (!fullLine) continue;

    const leadingGap =
      carryGap > 0 || hasLeadingWhitespace
        ? measureCollapsedSpaceWidth(run.font)
        : 0;

    items.push({
      font: run.font,
      isLink: !!run.isLink,
      isCode: !!run.isCode,
      prepared,
      fullText: fullLine.text,
      fullWidth: fullLine.width,
      endCursor: fullLine.end,
      leadingGap,
    });
  }

  return items;
}

function layoutNormalTextLines(
  runs: PaginationInlineRun[],
  maxWidth: number,
): PageTextLine[] {
  const safeWidth = Math.max(1, maxWidth);
  const items = prepareRunsForNormalLayout(runs);
  const lines: PageTextLine[] = [];

  let itemIndex = 0;
  let textCursor: LayoutCursor | null = null;

  while (itemIndex < items.length) {
    const fragments: PageTextFragment[] = [];
    let remainingWidth = safeWidth;

    lineLoop: while (itemIndex < items.length) {
      const item = items[itemIndex];
      if (!item) break;

      if (textCursor && cursorsMatch(textCursor, item.endCursor)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      const leadingGap = fragments.length === 0 ? 0 : item.leadingGap;
      if (fragments.length > 0 && leadingGap >= remainingWidth) {
        break lineLoop;
      }

      if (!textCursor) {
        const fullWidth = leadingGap + item.fullWidth;
        if (fullWidth <= remainingWidth) {
          fragments.push({
            text: item.fullText,
            font: item.font,
            leadingGap,
            isLink: item.isLink,
            isCode: item.isCode,
          });
          remainingWidth = Math.max(0, remainingWidth - fullWidth);
          itemIndex++;
          continue;
        }
      }

      const start = textCursor ?? LINE_START_CURSOR;
      const line = layoutNextLine(
        item.prepared,
        start,
        Math.max(1, remainingWidth - leadingGap),
      );

      if (!line || cursorsMatch(start, line.end)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      fragments.push({
        text: line.text,
        font: item.font,
        leadingGap,
        isLink: item.isLink,
        isCode: item.isCode,
      });

      remainingWidth = Math.max(0, remainingWidth - leadingGap - line.width);

      if (cursorsMatch(line.end, item.endCursor)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      textCursor = line.end;
      break lineLoop;
    }

    if (fragments.length === 0) break;
    lines.push({ fragments });
  }

  return lines;
}

function layoutPreWrapLines(
  runs: PaginationInlineRun[],
  maxWidth: number,
): PageTextLine[] {
  const firstRun = runs[0];
  if (!firstRun) return [];
  const combinedText = runs.map((run) => run.text).join("");

  const prepared = prepareWithSegments(combinedText, firstRun.font, {
    whiteSpace: "pre-wrap",
  });
  const result = layoutWithLines(prepared, Math.max(1, maxWidth), 1);

  return result.lines.map((line) => ({
    fragments: [
      {
        text: line.text,
        font: firstRun.font,
        leadingGap: 0,
        isLink: !!firstRun.isLink,
        isCode: true,
      },
    ],
  }));
}

function layoutTextBlockLines(
  block: PaginationTextBlock,
  pageWidth: number,
): PageTextLine[] {
  if (block.runs.length === 0) return [];
  if (block.whiteSpace === "pre-wrap") {
    return layoutPreWrapLines(block.runs, pageWidth);
  }
  return layoutNormalTextLines(block.runs, pageWidth);
}

function createPage(index: number): PaginationPage {
  return {
    index,
    usedHeight: 0,
    slices: [],
  };
}

export function paginateBlocksWithPretext(input: PaginationInput): PaginationResult {
  const { blocks, pageHeight, pageWidth } = input;
  const startedAt = performance.now();

  if (blocks.length === 0) {
    return {
      totalPages: 1,
      pages: [createPage(0)],
      diagnostics: {
        blockCount: 0,
        lineCount: 0,
        recomputeMs: 0,
      },
    };
  }

  const safePageHeight = Math.max(120, pageHeight);
  const safePageWidth = Math.max(140, pageWidth);

  const pages: PaginationPage[] = [];
  let currentPage = createPage(0);
  let totalLineCount = 0;

  const pushCurrentPage = () => {
    pages.push(currentPage);
    currentPage = createPage(pages.length);
  };

  const ensureCapacity = (neededHeight: number) => {
    const remaining = safePageHeight - currentPage.usedHeight;
    if (neededHeight <= remaining) return;
    if (currentPage.slices.length > 0) {
      pushCurrentPage();
    }
  };

  const addSpacerSlice = (blockId: string, height: number) => {
    let remainingHeight = Math.max(0, height);
    while (remainingHeight > 0) {
      const remaining = safePageHeight - currentPage.usedHeight;
      if (remaining <= 0) {
        pushCurrentPage();
        continue;
      }

      const chunk = Math.min(remainingHeight, remaining);
      if (chunk <= 0) break;

      currentPage.slices.push({
        id: `${blockId}-spacer-${currentPage.slices.length + 1}`,
        type: "spacer",
        blockId,
        height: chunk,
      });
      currentPage.usedHeight += chunk;
      remainingHeight -= chunk;

      if (remainingHeight > 0) {
        pushCurrentPage();
      }
    }
  };

  for (const block of blocks) {
    if (block.type === "spacer") {
      addSpacerSlice(block.id, block.height);
      continue;
    }

    if (block.type === "image") {
      addSpacerSlice(block.id, block.marginTop);
      ensureCapacity(block.height);

      let remainingHeight = safePageHeight - currentPage.usedHeight;
      if (remainingHeight <= 0) {
        pushCurrentPage();
        remainingHeight = safePageHeight - currentPage.usedHeight;
      }

      const displayHeight = Math.max(1, Math.min(block.height, remainingHeight));
      const scale = displayHeight / block.height;
      const displayWidth = clamp(block.width * scale, 40, safePageWidth);

      currentPage.slices.push({
        id: `${block.id}-image-${currentPage.slices.length + 1}`,
        type: "image",
        blockId: block.id,
        src: block.src,
        alt: block.alt,
        width: displayWidth,
        height: displayHeight,
      });
      currentPage.usedHeight += displayHeight;
      addSpacerSlice(block.id, block.marginBottom);
      continue;
    }

    addSpacerSlice(block.id, block.marginTop);
    const lines = layoutTextBlockLines(block, safePageWidth);
    totalLineCount += lines.length;

    if (lines.length === 0) {
      addSpacerSlice(block.id, block.marginBottom);
      continue;
    }

    let lineIndex = 0;
    while (lineIndex < lines.length) {
      let remainingHeight = safePageHeight - currentPage.usedHeight;
      if (remainingHeight <= 0) {
        pushCurrentPage();
        continue;
      }

      let maxLines = Math.floor(remainingHeight / block.lineHeight);
      if (maxLines <= 0) {
        if (currentPage.slices.length > 0) {
          pushCurrentPage();
          continue;
        }
        maxLines = 1;
      }

      const linesToTake = Math.min(maxLines, lines.length - lineIndex);
      const sliceLines = lines.slice(lineIndex, lineIndex + linesToTake);

      currentPage.slices.push({
        id: `${block.id}-text-${currentPage.slices.length + 1}`,
        type: "text",
        blockId: block.id,
        lineHeight: block.lineHeight,
        textAlign: block.textAlign,
        lines: sliceLines,
      });

      currentPage.usedHeight += sliceLines.length * block.lineHeight;
      lineIndex += linesToTake;
    }

    addSpacerSlice(block.id, block.marginBottom);
  }

  if (currentPage.slices.length > 0 || pages.length === 0) {
    pages.push(currentPage);
  }

  const recomputeMs = performance.now() - startedAt;

  return {
    totalPages: pages.length,
    pages,
    diagnostics: {
      blockCount: blocks.length,
      lineCount: totalLineCount,
      recomputeMs,
    },
  };
}
