// Highlight color definitions
// 'invisible' is for annotations with only notes (no visual highlight)
export const HIGHLIGHT_COLORS = [
  { name: "yellow" },
  { name: "green" },
  { name: "blue" },
  { name: "magenta" },
] as const;

// All colors including invisible (for annotations with notes only)
export const ANNOTATION_COLORS = [
  ...HIGHLIGHT_COLORS,
  { name: "invisible" },
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]["name"];
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]["name"];
