/** Highlight persistence, including timestamp normalization for stored rows. */
import type { SyncV2Highlight as StoredHighlight } from "@/lib/sync-v2/db";
import {
  optionalTimestampMs,
  toTimestampMs,
  type TimestampInput,
} from "@/lib/timestamps";
import type { Highlight } from "@/types/highlight";
import { db, isNotDeleted } from "./database";

export type { Highlight };

type LegacyStoredHighlight = Omit<
  StoredHighlight,
  "createdAt" | "updatedAt"
> & {
  createdAt: TimestampInput;
  updatedAt?: TimestampInput;
};

function normalizeHighlightTimestamps(
  highlight: StoredHighlight,
): StoredHighlight {
  const legacyHighlight = highlight as LegacyStoredHighlight;
  const updatedAt = optionalTimestampMs(legacyHighlight.updatedAt);

  return {
    ...highlight,
    createdAt: toTimestampMs(legacyHighlight.createdAt),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

export async function addHighlight(highlight: Highlight): Promise<string> {
  return db.highlights.add({ ...highlight, isDeleted: false });
}

export async function getHighlights(
  bookId: string,
  spineItemId: string,
): Promise<Highlight[]> {
  const highlights = await db.highlights
    .where("bookId")
    .equals(bookId)
    .and((h) => h.spineItemId === spineItemId && isNotDeleted(h))
    .toArray();

  return highlights.map(normalizeHighlightTimestamps);
}

export async function getBookHighlights(bookId: string): Promise<Highlight[]> {
  const highlights = await db.highlights
    .where("bookId")
    .equals(bookId)
    .filter(isNotDeleted)
    .toArray();

  return highlights.map(normalizeHighlightTimestamps);
}

export async function deleteHighlight(id: string): Promise<void> {
  const highlight = await db.highlights.get(id);
  if (!highlight || highlight.isDeleted) return;

  await db.highlights.delete(id);
}

export async function updateHighlight(
  id: string,
  changes: Partial<Highlight>,
): Promise<void> {
  const highlight = await db.highlights.get(id);
  if (!highlight || isNotDeleted(highlight) === false) return;

  await db.highlights.put({
    ...normalizeHighlightTimestamps(highlight),
    ...changes,
    updatedAt: Date.now(),
  });
}

export async function getAllHighlights(): Promise<Highlight[]> {
  const highlights = await db.highlights.filter(isNotDeleted).toArray();
  return highlights.map(normalizeHighlightTimestamps);
}
