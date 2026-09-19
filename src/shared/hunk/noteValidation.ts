import type { Note, NoteInput } from '../protocol';
import { utf8ByteLength } from './validation';

/** Validate note text before any state change. Limits apply to UTF-8 bytes. */
export function validateReviewNoteText(text: string): void {
  if (!text.trim()) throw new Error('A note must contain text.');
  if (utf8ByteLength(text) > 16_384) throw new Error('A note must not exceed 16 KiB.');
}

export function reviewSourceLineCount(source: string): number {
  if (!source.length) return 0;
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
}

/** Sources must be the exact versions named by the addressed review. */
export function validateReviewNoteInput(
  note: NoteInput,
  sources: { old: string; new: string },
  existingNotes: readonly Note[] = [],
): void {
  validateReviewNoteText(note.text);
  const end = note.endLine ?? note.line;
  const count = reviewSourceLineCount(sources[note.side]);
  if (!Number.isInteger(note.line) || !Number.isInteger(end) || note.line < 1 || end < note.line || end > count) {
    throw new Error('The note range is outside this file version.');
  }
  if (note.parentId) {
    const parent = existingNotes.find((candidate) => candidate.id === note.parentId);
    if (!parent || parent.path !== note.path) throw new Error('A reply must refer to a note in the same file.');
  }
}

export function validateReviewNoteRemoval(id: string, notes: readonly Note[]): void {
  if (!notes.some((note) => note.id === id)) throw new Error('This note no longer exists.');
  if (notes.some((note) => note.parentId === id)) throw new Error('Remove replies before removing their parent note.');
}
