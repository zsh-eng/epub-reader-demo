// Anchor helpers for the pagination engine: resolve between content anchors,
// pages, and fragment targets without owning any engine state directly.
import type {
    Page,
    PreparedBlock,
    PreparedTextBlock,
    TextCursorOffset,
} from "../shared/types";
import type { ContentAnchor } from "../types";

function compareOffsets(a: TextCursorOffset, b: TextCursorOffset): number {
  if (a.itemIndex !== b.itemIndex) return a.itemIndex < b.itemIndex ? -1 : 1;
  if (a.segmentIndex !== b.segmentIndex) {
    return a.segmentIndex < b.segmentIndex ? -1 : 1;
  }
  if (a.graphemeIndex !== b.graphemeIndex) {
    return a.graphemeIndex < b.graphemeIndex ? -1 : 1;
  }
  return 0;
}

function resolveFirstTextAnchor(
  chapterIndex: number,
  block: PreparedTextBlock,
): ContentAnchor | null {
  // "Start of block" means the first prepared text item, which is the same
  // ownership boundary the parser used when normalizing fragment targets.
  for (let itemIndex = 0; itemIndex < block.items.length; itemIndex++) {
    const item = block.items[itemIndex];
    if (!item) continue;

    return {
      type: "text",
      chapterIndex,
      blockId: block.id,
      offset: {
        itemIndex,
        segmentIndex: 0,
        graphemeIndex: 0,
      },
    };
  }

  return null;
}

function resolveTextItemTargetAnchor(
  chapterIndex: number,
  block: PreparedTextBlock,
  targetId: string,
): ContentAnchor | null {
  // Item-owned targets are already attached to the nearest renderable text
  // run during parse, so resolving them is just "jump to the start of that
  // prepared text item".
  for (let itemIndex = 0; itemIndex < block.items.length; itemIndex++) {
    const item = block.items[itemIndex];
    if (item?.targetIds?.includes(targetId)) {
      return {
        type: "text",
        chapterIndex,
        blockId: block.id,
        offset: {
          itemIndex,
          segmentIndex: 0,
          graphemeIndex: 0,
        },
      };
    }
  }

  return null;
}

export function resolveAnchorToPage(
  pagesByChapter: (Page[] | null)[],
  anchor: ContentAnchor,
): { chapterIndex: number; localPageIndex: number } | null {
  const pages = pagesByChapter[anchor.chapterIndex];
  if (!pages) return null;

  const { blockId } = anchor;

  if (anchor.type === "block") {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) continue;
      for (const slice of page.slices) {
        if (slice.blockId === blockId) {
          return { chapterIndex: anchor.chapterIndex, localPageIndex: i };
        }
      }
    }
    return { chapterIndex: anchor.chapterIndex, localPageIndex: 0 };
  }

  const { offset: anchorOffset } = anchor;
  let firstBlockPage: number | null = null;
  let nearestPrecedingPage: number | null = null;
  let nearestPrecedingEnd: TextCursorOffset | null = null;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!page) continue;
    for (const slice of page.slices) {
      if (slice.blockId !== blockId) continue;
      if (firstBlockPage === null) firstBlockPage = i;

      if (slice.type !== "text") continue;
      for (const line of slice.lines) {
        const { startOffset, endOffset } = line;
        if (!startOffset || !endOffset) continue;

        const startCmp = compareOffsets(startOffset, anchorOffset);
        const endCmp = compareOffsets(anchorOffset, endOffset);
        if (startCmp <= 0 && endCmp < 0) {
          return { chapterIndex: anchor.chapterIndex, localPageIndex: i };
        }

        if (compareOffsets(endOffset, anchorOffset) <= 0) {
          if (
            !nearestPrecedingEnd ||
            compareOffsets(endOffset, nearestPrecedingEnd) > 0
          ) {
            nearestPrecedingEnd = endOffset;
            nearestPrecedingPage = i;
          }
        }
      }
    }
  }

  if (nearestPrecedingPage !== null) {
    return {
      chapterIndex: anchor.chapterIndex,
      localPageIndex: nearestPrecedingPage,
    };
  }
  if (firstBlockPage !== null) {
    return {
      chapterIndex: anchor.chapterIndex,
      localPageIndex: firstBlockPage,
    };
  }
  return { chapterIndex: anchor.chapterIndex, localPageIndex: 0 };
}

export function resolveAnchorToGlobalPage(
  pagesByChapter: (Page[] | null)[],
  chapterPageOffsets: number[],
  anchor: ContentAnchor,
): number | null {
  const resolved = resolveAnchorToPage(pagesByChapter, anchor);
  if (!resolved) return null;

  const offset = chapterPageOffsets[resolved.chapterIndex] ?? 0;
  return offset + resolved.localPageIndex + 1;
}

export function pickAnchorForPage(
  pagesByChapter: (Page[] | null)[],
  chapterIndex: number,
  localPageIndex: number,
): ContentAnchor {
  const pages = pagesByChapter[chapterIndex];
  const page = pages?.[localPageIndex];

  if (!page || page.slices.length === 0) {
    return { type: "block", chapterIndex, blockId: "" };
  }

  // Spacers are not meaningful anchors: a spacer's blockId is often shared
  // with the image that follows it (both come from the same block in the
  // source), so anchoring to a spacer causes resolveAnchorToPage to find
  // the wrong page when two slices share the same blockId.
  const anchorableSlices = page.slices.filter((slice) => slice.type !== "spacer");
  const slices = anchorableSlices.length > 0 ? anchorableSlices : page.slices;

  const midSlice = slices[Math.floor(slices.length / 2)];
  if (!midSlice) {
    return { type: "block", chapterIndex, blockId: page.slices[0]!.blockId };
  }

  if (midSlice.type !== "text") {
    return { type: "block", chapterIndex, blockId: midSlice.blockId };
  }

  const midLine = midSlice.lines[Math.floor(midSlice.lines.length / 2)];
  if (midLine?.startOffset) {
    return {
      type: "text",
      chapterIndex,
      blockId: midSlice.blockId,
      offset: { ...midLine.startOffset },
    };
  }

  return { type: "block", chapterIndex, blockId: midSlice.blockId };
}

export function resolveTargetToAnchor(
  preparedByChapter: (PreparedBlock[] | null)[],
  chapterIndex: number,
  targetId: string,
): ContentAnchor | null {
  const prepared = preparedByChapter[chapterIndex];
  if (!prepared) return null;

  // Targets are normalized during parse: by the time they reach the engine,
  // a fragment id belongs either to a block or to a concrete text item.
  // That lets navigation resolve directly to an existing block/text anchor
  // without synthesizing extra zero-width positions at runtime.
  for (const block of prepared) {
    const matchesBlockTarget = block.targetIds?.includes(targetId) ?? false;
    if (matchesBlockTarget) {
      if (block.type === "text") {
        // Block-owned text targets land at the first renderable text item in
        // the block so pagination can reuse the normal text-offset anchor path.
        return resolveFirstTextAnchor(chapterIndex, block);
      }

      if (block.type !== "page-break") {
        return { type: "block", chapterIndex, blockId: block.id };
      }
      continue;
    }

    if (block.type === "text") {
      const textItemTargetAnchor = resolveTextItemTargetAnchor(
        chapterIndex,
        block,
        targetId,
      );
      if (textItemTargetAnchor) return textItemTargetAnchor;
    }
  }

  return null;
}
