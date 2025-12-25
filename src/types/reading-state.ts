/**
 * Reading State Types
 *
 * Defines the reading status tracking types for books.
 * Uses a log-based pattern for sync - each status change creates a new entry.
 */

export type ReadingStatus = "want-to-read" | "reading" | "finished" | "dnf";

export interface ReadingState {
  id: string; // UUID primary key
  bookId: string; // Foreign key to Book
  status: ReadingStatus;
  timestamp: number; // When this state was set (user-facing timestamp)
  createdAt: number; // When record was created (for sync ordering)
}
