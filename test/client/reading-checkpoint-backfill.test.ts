import {
  backfillLegacyReadingProgressCheckpoints,
  createReadingCheckpointId,
  db,
  type Book,
  type ReadingCheckpoint,
  type ReadingProgress,
} from "@/lib/db";
import { beforeEach, describe, expect, it } from "vitest";

type StoredBook = Book & { isDeleted: boolean };
type StoredProgress = ReadingProgress & { isDeleted: boolean };
type StoredCheckpoint = ReadingCheckpoint & { isDeleted: boolean };

function makeBook(id: string): StoredBook {
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
    isDeleted: false,
  };
}

function makeProgress(
  overrides: Partial<StoredProgress> & {
    id: string;
    bookId: string;
    deviceId: string;
    lastRead: number;
  },
): StoredProgress {
  return {
    id: overrides.id,
    bookId: overrides.bookId,
    currentSpineIndex: overrides.currentSpineIndex ?? 0,
    scrollProgress: overrides.scrollProgress ?? 0,
    lastRead: overrides.lastRead,
    createdAt: overrides.createdAt ?? overrides.lastRead,
    deviceId: overrides.deviceId,
    triggerType: overrides.triggerType ?? "periodic",
    isDeleted: overrides.isDeleted ?? false,
  };
}

function makeCheckpoint(
  overrides: Partial<StoredCheckpoint> & {
    bookId: string;
    deviceId: string;
  },
): StoredCheckpoint {
  return {
    id: createReadingCheckpointId(overrides.bookId, overrides.deviceId),
    bookId: overrides.bookId,
    deviceId: overrides.deviceId,
    currentSpineIndex: overrides.currentSpineIndex ?? 0,
    scrollProgress: overrides.scrollProgress ?? 0,
    lastRead: overrides.lastRead ?? 0,
    isDeleted: overrides.isDeleted ?? false,
  };
}

describe("legacy reading progress checkpoint backfill", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    localStorage.clear();
    localStorage.setItem("epub-reader-device-id", "writer-device");
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
        isDeleted: true,
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
      isDeleted: false,
    });
    expect(checkpointB).toMatchObject({
      bookId: "book-1",
      deviceId: "device-b",
      currentSpineIndex: 3,
      scrollProgress: 88,
      lastRead: 150,
      isDeleted: false,
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
