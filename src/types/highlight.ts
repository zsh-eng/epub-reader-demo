/**
 * Highlight Type Definition
 *
 * Represents a text highlight in an EPUB book with position data,
 * context for fallback matching, and styling information.
 */

import type { HighlightColor } from "@/lib/highlight-constants";

export type { HighlightColor };

export interface Highlight {
  // Identity
  id: string; // UUID
  bookId: string; // Foreign key to Book
  spineItemId: string; // The spine item's idref (identifies the chapter)

  // Position (Primary method)
  startOffset: number; // Character offset in text-only content
  endOffset: number; // Character offset in text-only content

  // Content (For fallback matching)
  selectedText: string; // The actual highlighted text (max ~500 chars)
  textBefore: string; // ~50 chars before highlight (for context)
  textAfter: string; // ~50 chars after highlight (for context)

  // Styling
  color: HighlightColor; // Predefined color names

  // Optional annotation
  note?: string; // User's notes on this highlight

  // Metadata
  createdAt: Date;
  updatedAt?: Date;
}
