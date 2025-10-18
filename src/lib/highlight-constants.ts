// Highlight color definitions
export const HIGHLIGHT_COLORS = [
  { name: "yellow", value: "rgba(255, 235, 59, 0.35)", hex: "#FFEB3B" },
  { name: "green", value: "rgba(76, 175, 80, 0.35)", hex: "#4CAF50" },
  { name: "blue", value: "rgba(33, 150, 243, 0.35)", hex: "#2196F3" },
  { name: "pink", value: "rgba(233, 30, 99, 0.35)", hex: "#E91E63" },
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]["name"];
