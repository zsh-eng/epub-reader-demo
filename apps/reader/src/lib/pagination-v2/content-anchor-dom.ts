import type { TextCursorOffset } from "./shared/types";

export const CONTENT_ANCHOR_BLOCK_ID_ATTR = "data-content-anchor-block-id";
export const CONTENT_ANCHOR_START_ATTR = "data-content-anchor-start";
export const CONTENT_ANCHOR_END_ATTR = "data-content-anchor-end";

export function serializeTextCursorOffset(offset: TextCursorOffset): string {
  return `${offset.itemIndex}:${offset.segmentIndex}:${offset.graphemeIndex}`;
}

export function parseTextCursorOffset(
  value: string | null | undefined,
): TextCursorOffset | null {
  if (!value) return null;

  const parts = value.split(":");
  if (parts.length !== 3) return null;

  const [itemIndex, segmentIndex, graphemeIndex] = parts.map((part) =>
    Number.parseInt(part, 10),
  );
  if (
    !Number.isInteger(itemIndex) ||
    !Number.isInteger(segmentIndex) ||
    !Number.isInteger(graphemeIndex) ||
    itemIndex < 0 ||
    segmentIndex < 0 ||
    graphemeIndex < 0
  ) {
    return null;
  }

  return {
    itemIndex,
    segmentIndex,
    graphemeIndex,
  };
}
