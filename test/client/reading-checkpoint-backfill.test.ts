import {
  backfillLegacyReadingProgressCheckpoints,
  createReadingCheckpointId,
  db,
  type Book,
  type SyncedBook,
  type SyncedReadingCheckpoint,
  type SyncedReadingProgress,
} from "@/lib/db";
import { UNSYNCED_TIMESTAMP } from "@/lib/sync/hlc/schema";
import { beforeEach, describe, expect, it } from "vitest";

function makeBook(id: string): SyncedBook {
  return {
    id,
    fileHash: `hash-${id}`,
    title: id,
    author: "Author",
    fileSize: 100,
    dateAdded: 0,
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
    isDownloaded: 1,
  } as Book as SyncedBook;
}

function makeProgress(
  overrides: Partial<SyncedReadingProgress> & {
    id: string;
    bookId: string;
    deviceId: string;
    lastRead: number;
  },
): SyncedReadingProgress {
  return {
    id: overrides.id,
    bookId: overrides.bookId,
    currentSpineIndex: overrides.currentSpineIndex ?? 0,
    scrollProgress: overrides.scrollProgress ?? 0,
    lastRead: overrides.lastRead,
    createdAt: overrides.createdAt ?? overrides.lastRead,
    triggerType: overrides.triggerType ?? "periodic",
    _hlc: overrides._hlc ?? `${overrides.lastRead}-0-${overrides.deviceId}`,
    _deviceId: overrides.deviceId,
    _serverTimestamp: overrides._serverTimestamp ?? overrides.lastRead,
    _isDeleted: overrides._isDeleted ?? 0,
  };
}

function makeCheckpoint(
  overrides: Partial<SyncedReadingCheckpoint> & {
    bookId: string;
    deviceId: string;
  },
): SyncedReadingCheckpoint {
  return {
    id: createReadingCheckpointId(overrides.bookId, overrides.deviceId),
    bookId: overrides.bookId,
    deviceId: overrides.deviceId,
    currentSpineIndex: overrides.currentSpineIndex ?? 0,
    scrollProgress: overrides.scrollProgress ?? 0,
    lastRead: overrides.lastRead ?? 0,
    _hlc: overrides._hlc ?? "1-0-existing",
    _deviceId: overrides._deviceId ?? "existing-writer",
    _serverTimestamp: overrides._serverTimestamp ?? 1,
    _isDeleted: overrides._isDeleted ?? 0,
  };
}

describe("legacy reading progress checkpoint backfill", () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem("epub-reader-device-id", "writer-device");
    await db.readingCheckpoints.clear();
    await db.readingProgress.clear();
    await db.books.clear();
  });

  it("creates pending checkpoints from the latest progress row per book and device", async () => {
    await db.books.bulkAdd([makeBook("book-1"), makeBook("book-2")]);
    await db.readingCheckpoints.add(
      makeCheckpoint({
        bookId: "book-1",
        deviceId: "device-a",
        currentSpineIndex: 99,
        scrollProgress: 99,
        lastRead: 99,
      }),
    );
    await db.readingProgress.bulkAdd([
      makeProgress({
        id: "book-1-device-a-old",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 100,
        currentSpineIndex: 2,
        scrollProgress: 0.25,
      }),
      makeProgress({
        id: "book-1-device-a-latest",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 200,
        currentSpineIndex: 5,
        scrollProgress: 0.75,
      }),
      makeProgress({
        id: "book-1-device-b",
        bookId: "book-1",
        deviceId: "device-b",
        lastRead: 150,
        currentSpineIndex: 3,
        scrollProgress: 88,
      }),
      makeProgress({
        id: "book-2-deleted",
        bookId: "book-2",
        deviceId: "device-a",
        lastRead: 300,
        _isDeleted: 1,
      }),
      makeProgress({
        id: "orphaned",
        bookId: "missing-book",
        deviceId: "device-a",
        lastRead: 400,
      }),
    ]);

    const result = await backfillLegacyReadingProgressCheckpoints();

    expect(result).toMatchObject({
      dryRun: false,
      progressRowsRead: 4,
      progressRowsConsidered: 3,
      progressRowsSkipped: 1,
      checkpointsGenerated: 2,
      existingCheckpointsOverwritten: 1,
    });

    const checkpointA = await db.readingCheckpoints.get(
      createReadingCheckpointId("book-1", "device-a"),
    );
    const checkpointB = await db.readingCheckpoints.get(
      createReadingCheckpointId("book-1", "device-b"),
    );

    expect(checkpointA).toMatchObject({
      bookId: "book-1",
      deviceId: "device-a",
      currentSpineIndex: 5,
      scrollProgress: 75,
      lastRead: 200,
      _deviceId: "writer-device",
      _serverTimestamp: UNSYNCED_TIMESTAMP,
      _isDeleted: 0,
    });
    expect(checkpointB).toMatchObject({
      bookId: "book-1",
      deviceId: "device-b",
      currentSpineIndex: 3,
      scrollProgress: 88,
      lastRead: 150,
      _deviceId: "writer-device",
      _serverTimestamp: UNSYNCED_TIMESTAMP,
      _isDeleted: 0,
    });
  });

  it("supports dry runs without mutating checkpoints", async () => {
    await db.books.add(makeBook("book-1"));
    await db.readingProgress.add(
      makeProgress({
        id: "progress-1",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 100,
      }),
    );

    const result = await backfillLegacyReadingProgressCheckpoints({
      dryRun: true,
    });

    expect(result).toMatchObject({
      dryRun: true,
      checkpointsGenerated: 1,
    });
    expect(await db.readingCheckpoints.toArray()).toEqual([]);
  });
});
