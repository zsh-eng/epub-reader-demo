/**
 * Represents a target scroll position within a chapter.
 * Used to coordinate navigation and scroll restoration.
 */
export type ScrollTarget =
  | { type: "top" }
  | { type: "fragment"; id: string }
  | { type: "percentage"; value: number }
  | { type: "highlight"; highlightId: string };
