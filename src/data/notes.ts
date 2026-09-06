/** Annotation notes, with normalized timestamps and stable display order. */
import type { SyncV2Note as StoredNote } from "@/lib/sync-v2/db";
import {
  optionalTimestampMs,
  toTimestampMs,
  type TimestampInput,
} from "@/lib/timestamps";
import type { Note } from "@/types/note";
import { db, isNotDeleted } from "./database";

export type { Note };

type LegacyStoredNote = Omit<StoredNote, "createdAt" | "updatedAt"> & {
  createdAt: TimestampInput;
  updatedAt?: TimestampInput;
};

function normalizeNoteTimestamps(note: StoredNote): StoredNote {
  const legacyNote = note as LegacyStoredNote;
  const updatedAt = optionalTimestampMs(legacyNote.updatedAt);

  return {
    ...note,
    createdAt: toTimestampMs(legacyNote.createdAt),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

function compareCreatedAtAscending(
  a: { id: string; createdAt: number },
  b: { id: string; createdAt: number },
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

export async function addNote(note: Note): Promise<string> {
  return db.notes.add({ ...note, isDeleted: false });
}

export async function getNotesByAnnotation(
  annotationId: string,
): Promise<Note[]> {
  const notes = await db.notes
    .where("annotationId")
    .equals(annotationId)
    .filter(isNotDeleted)
    .toArray();

  return notes.map(normalizeNoteTimestamps).sort(compareCreatedAtAscending);
}

export async function getChapterNotes(
  bookId: string,
  spineItemId: string,
): Promise<Note[]> {
  const notes = await db.notes
    .where("[bookId+spineItemId]")
    .equals([bookId, spineItemId])
    .filter((n) => n.annotationType === "chapter" && isNotDeleted(n))
    .toArray();

  return notes.map(normalizeNoteTimestamps).sort(compareCreatedAtAscending);
}

export async function updateNote(id: string, content: string): Promise<void> {
  const note = await db.notes.get(id);
  if (!note || !isNotDeleted(note)) return;

  await db.notes.put({
    ...normalizeNoteTimestamps(note),
    content,
    updatedAt: Date.now(),
  });
}

export async function deleteNote(id: string): Promise<void> {
  const note = await db.notes.get(id);
  if (!note || note.isDeleted) return;

  await db.notes.delete(id);
}

export async function getAllNotes(): Promise<Note[]> {
  const notes = await db.notes.filter(isNotDeleted).toArray();
  return notes.map(normalizeNoteTimestamps);
}
