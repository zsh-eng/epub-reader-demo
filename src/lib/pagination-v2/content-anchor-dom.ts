import type { TextCursorOffset } from "./shared/types";

export const CONTENT_ANCHOR_BLOCK_ID_ATTR = "data-content-anchor-block-id";
export const CONTENT_ANCHOR_START_ATTR = "data-content-anchor-start";
export const CONTENT_ANCHOR_END_ATTR = "data-content-anchor-end";

export function serializeTextCursorOffset(offset: TextCursorOffset): string {
  return `${offset.itemIndex}:${offset.segmentIndex}:${offset.graphemeIndex}`;
}
