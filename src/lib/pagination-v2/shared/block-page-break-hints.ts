import type { Block, BookPageBreakHints } from "./types";

function mergeBreakAfter(
  current: BookPageBreakHints["breakAfter"],
  next: BookPageBreakHints["breakAfter"],
): BookPageBreakHints["breakAfter"] | undefined {
  if (current === "page" || next === "page") return "page";
  return next ?? current;
}

export function mergeBookPageBreakHints(
  current: BookPageBreakHints | undefined,
  next: BookPageBreakHints | undefined,
): BookPageBreakHints | undefined {
  if (!current) return next ? { ...next } : undefined;
  if (!next) return { ...current };

  const breakAfter = mergeBreakAfter(current.breakAfter, next.breakAfter);
  const merged: BookPageBreakHints = {
    ...(current.breakBefore || next.breakBefore
      ? { breakBefore: next.breakBefore ?? current.breakBefore }
      : {}),
    ...(breakAfter ? { breakAfter } : {}),
    ...(current.breakInside || next.breakInside
      ? { breakInside: next.breakInside ?? current.breakInside }
      : {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function attachPageBreakHintsToBlock(
  block: Block,
  hints: BookPageBreakHints | undefined,
): void {
  if (!hints || block.type === "page-break") return;
  block.pageBreakHints = mergeBookPageBreakHints(block.pageBreakHints, hints);
}

function findLastMaterializedBlock(blocks: Block[]): Block | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block && block.type !== "page-break") return block;
  }
  return undefined;
}

/**
 * Container page-break hints are attached to the blocks the parser actually
 * materializes. This is deliberately not a grouping model: multi-block figure
 * and caption grouping remains a later design.
 */
export function applyContainerPageBreakHints(
  blocks: Block[],
  hints: BookPageBreakHints | undefined,
): void {
  if (!hints || blocks.length === 0) return;

  const firstBlock = blocks.find((block) => block.type !== "page-break");
  const lastBlock = findLastMaterializedBlock(blocks);
  if (!firstBlock || !lastBlock) return;

  if (hints.breakBefore) {
    attachPageBreakHintsToBlock(firstBlock, {
      breakBefore: hints.breakBefore,
    });
  }
  if (hints.breakInside) {
    for (const block of blocks) {
      attachPageBreakHintsToBlock(block, { breakInside: hints.breakInside });
    }
  }
  if (hints.breakAfter) {
    attachPageBreakHintsToBlock(lastBlock, { breakAfter: hints.breakAfter });
  }
}
