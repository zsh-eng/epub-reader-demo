import { db, getBookReadingSessions, type ReadingSession } from "@/lib/db";
import { getRecordedReadingTimeSummary } from "@/lib/reading-session-stats";
import { afterEach, beforeEach, expect, it } from "vitest";

beforeEach(async () => {
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

it("reads only the book's surviving sessions across devices", async () => {
  const now = new Date(2026, 8, 13, 12).getTime();
  const record = (
    id: string,
    bookId: string,
    activeMinutes: number,
  ): ReadingSession => ({
    id,
    bookId,
    deviceId: id,
    readerInstanceId: id,
    startedAt: now - 4 * 60 * 60_000,
    endedAt: now,
    lastActiveAt: now,
    activeMs: activeMinutes * 60_000,
    startSpineIndex: 0,
    startScrollProgress: 0,
    endSpineIndex: 1,
    endScrollProgress: 20,
  });
  await db.readingSessions.bulkPut([
    { ...record("phone", "book-a", 10), isDeleted: false },
    { ...record("tablet", "book-a", 8), isDeleted: false },
    { ...record("removed", "book-a", 100), isDeleted: true },
    { ...record("other-book", "book-b", 90), isDeleted: false },
  ]);
  const records = await getBookReadingSessions("book-a");
  expect(records.map((session) => session.id).sort()).toEqual([
    "phone",
    "tablet",
  ]);
  expect(getRecordedReadingTimeSummary(records, now)).toEqual({
    todayMs: 18 * 60_000,
    totalMs: 18 * 60_000,
  });
  expect(await getBookReadingSessions("missing-book")).toEqual([]);
});
