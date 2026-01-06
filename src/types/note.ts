/**
 * Note Type Definition
 *
 * Represents a note attached to an annotation (highlight or chapter).
 * Multiple notes can be attached to a single annotation, creating a
 * threaded conversation.
 */

export interface Note {
  // Identity
  id: string; // UUID
  annotationId: string; // FK to Highlight.id or chapter annotation ID
  annotationType: "highlight" | "chapter";

  // Location (denormalized for efficient querying)
  bookId: string;
  spineItemId: string;

  // Content
  content: string;

  // Metadata
  createdAt: Date;
  updatedAt?: Date;
}
