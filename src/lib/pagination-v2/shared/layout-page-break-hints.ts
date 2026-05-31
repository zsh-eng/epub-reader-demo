import type { BookPageBreakHints, PreparedBlock } from "./types";

function getBlockPageBreakHints(
  block: PreparedBlock,
): BookPageBreakHints | undefined {
  return block.type === "page-break" ? undefined : block.pageBreakHints;
}

export function hasHardPageBreakBefore(block: PreparedBlock): boolean {
  return getBlockPageBreakHints(block)?.breakBefore === "page";
}

export function hasHardPageBreakAfter(block: PreparedBlock): boolean {
  return getBlockPageBreakHints(block)?.breakAfter === "page";
}

export function shouldMoveTextBlockForPageBreakHints(options: {
  hints: BookPageBreakHints | undefined;
  currentPageHasContent: boolean;
  gapBefore: number;
  blockHeight: number;
  availableBeforeBlock: number;
  safeHeight: number;
  followingMinimumHeight: number | null;
}): boolean {
  const {
    hints,
    currentPageHasContent,
    gapBefore,
    blockHeight,
    availableBeforeBlock,
    safeHeight,
    followingMinimumHeight,
  } = options;

  if (!hints || !currentPageHasContent) return false;

  const moveForKeepInside =
    hints.breakInside === "avoid" &&
    blockHeight <= safeHeight &&
    gapBefore + blockHeight > availableBeforeBlock;
  if (moveForKeepInside) return true;

  return (
    hints.breakAfter === "avoid" &&
    followingMinimumHeight !== null &&
    blockHeight + followingMinimumHeight <= safeHeight &&
    gapBefore + blockHeight + followingMinimumHeight > availableBeforeBlock
  );
}
