// Highlight color definitions
export const HIGHLIGHT_COLORS = [
  { name: "yellow" },
  { name: "green" },
  { name: "blue" },
  { name: "magenta" },
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]["name"];
