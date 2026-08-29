import {
  backfillLegacyReadingProgressSessions,
  db,
  type Book,
  type ReadingProgress,
  type ReadingSession,
} from "@/lib/db";
import { beforeEach, describe, expect, it } from "vitest";

const LEGACY_SESSION_ID_PREFIX = "legacy-reading-progress:v1:";
type StoredBook = Book & { isDeleted: boolean };
type StoredProgress = ReadingProgress & { isDeleted: boolean };
type StoredSession = ReadingSession & { isDeleted: boolean };

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

function makeSession(
  overrides: Partial<StoredSession> & { id: string },
): StoredSession {
  return {
    id: overrides.id,
    bookId: overrides.bookId ?? "book-1",
    deviceId: overrides.deviceId ?? "device-a",
    readerInstanceId: overrides.readerInstanceId ?? "reader-1",
    startedAt: overrides.startedAt ?? 0,
    endedAt: overrides.endedAt ?? null,
    lastActiveAt: overrides.lastActiveAt ?? 0,
    activeMs: overrides.activeMs ?? 0,
    startSpineIndex: overrides.startSpineIndex ?? 0,
    startScrollProgress: overrides.startScrollProgress ?? 0,
    endSpineIndex: overrides.endSpineIndex ?? 0,
    endScrollProgress: overrides.endScrollProgress ?? 0,
    isDeleted: overrides.isDeleted ?? false,
  };
}

function legacySessionId(
  deviceId: string,
  bookId: string,
  startedAt: number,
): string {
  return `${LEGACY_SESSION_ID_PREFIX}${deviceId}:${bookId}:${startedAt}`;
}

async function getLegacySessions(): Promise<ReadingSession[]> {
  return db.readingSessions
    .filter((session) => session.id.startsWith(LEGACY_SESSION_ID_PREFIX))
    .toArray();
}

async function getActiveLegacySessions(): Promise<ReadingSession[]> {
  return db.readingSessions
    .filter(
      (session) =>
        session.id.startsWith(LEGACY_SESSION_ID_PREFIX) && !session.isDeleted,
    )
    .toArray();
}

describe("legacy reading progress session backfill", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    localStorage.clear();
  });

  it("infers sessions by book and device, splitting after idle gaps", async () => {
    await db.books.bulkAdd([makeBook("book-1"), makeBook("book-2")]);
    await db.readingProgress.bulkAdd([
      makeProgress({
        id: "book-1-device-a-start",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 0,
        currentSpineIndex: 1,
        scrollProgress: 0.25,
      }),
      makeProgress({
        id: "book-1-device-b",
        bookId: "book-1",
        deviceId: "device-b",
        lastRead: 30_000,
        currentSpineIndex: 5,
        scrollProgress: 12,
      }),
      makeProgress({
        id: "book-2-device-a",
        bookId: "book-2",
        deviceId: "device-a",
        lastRead: 10_000,
        currentSpineIndex: 7,
        scrollProgress: 75,
      }),
      makeProgress({
        id: "book-1-device-a-next",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 60_000,
        currentSpineIndex: 2,
        scrollProgress: 50,
      }),
      makeProgress({
        id: "book-1-device-a-after-idle",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 660_001,
        currentSpineIndex: 3,
        scrollProgress: 90,
      }),
      makeProgress({
        id: "deleted",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 120_000,
        isDeleted: true,
      }),
      makeProgress({
        id: "orphaned",
        bookId: "missing-book",
        deviceId: "device-a",
        lastRead: 120_000,
      }),
    ]);

    const result = await backfillLegacyReadingProgressSessions();

    expect(result).toMatchObject({
      progressRowsRead: 6,
      progressRowsConsidered: 5,
      progressRowsSkipped: 1,
      sessionsGenerated: 4,
      activeMs: 60_000,
    });

    const sessions = await getActiveLegacySessions();
    const byId = new Map(sessions.map((session) => [session.id, session]));

    expect(sessions).toHaveLength(4);
    expect(byId.get(legacySessionId("device-a", "book-1", 0))).toMatchObject({
      bookId: "book-1",
      deviceId: "device-a",
      readerInstanceId: "legacy-import:device-a:book-1:0",
      startedAt: 0,
      endedAt: 60_000,
      lastActiveAt: 60_000,
      activeMs: 60_000,
      startSpineIndex: 1,
      startScrollProgress: 25,
      endSpineIndex: 2,
      endScrollProgress: 50,
    });
    expect(
      byId.get(legacySessionId("device-a", "book-1", 660_001)),
    ).toMatchObject({
      activeMs: 0,
      startedAt: 660_001,
      endedAt: 660_001,
    });
    expect(
      byId.get(legacySessionId("device-b", "book-1", 30_000)),
    ).toBeTruthy();
    expect(
      byId.get(legacySessionId("device-a", "book-2", 10_000)),
    ).toBeTruthy();
  });

  it("supports dry runs without mutating reading sessions", async () => {
    await db.books.add(makeBook("book-1"));
    await db.readingSessions.add(
      makeSession({
        id: legacySessionId("device-a", "book-1", 123),
      }),
    );
    await db.readingProgress.bulkAdd([
      makeProgress({
        id: "progress-1",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 0,
      }),
      makeProgress({
        id: "progress-2",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 30_000,
      }),
    ]);

    const result = await backfillLegacyReadingProgressSessions({
      dryRun: true,
    });

    expect(result).toMatchObject({
      dryRun: true,
      sessionsGenerated: 1,
      existingLegacySessions: 1,
      legacySessionsSoftDeleted: 0,
      activeMs: 30_000,
    });
    expect(await db.readingSessions.toArray()).toEqual([
      expect.objectContaining({
        id: legacySessionId("device-a", "book-1", 123),
        isDeleted: false,
      }),
    ]);
  });

  it("reruns by soft-deleting previous legacy imports before inserting the recomputed set", async () => {
    await db.books.add(makeBook("book-1"));
    await db.readingSessions.add(
      makeSession({
        id: "native-session",
      }),
    );
    await db.readingProgress.bulkAdd([
      makeProgress({
        id: "start",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 0,
      }),
      makeProgress({
        id: "after-gap",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 700_001,
      }),
    ]);

    expect(await backfillLegacyReadingProgressSessions()).toMatchObject({
      sessionsGenerated: 2,
      existingLegacySessions: 0,
      legacySessionsSoftDeleted: 0,
    });
    expect(await getActiveLegacySessions()).toHaveLength(2);

    await db.readingProgress.add(
      makeProgress({
        id: "bridging-row",
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 350_000,
      }),
    );

    expect(await backfillLegacyReadingProgressSessions()).toMatchObject({
      sessionsGenerated: 1,
      existingLegacySessions: 2,
      legacySessionsSoftDeleted: 2,
      activeMs: 700_001,
    });

    const legacySessions = await getLegacySessions();
    const activeLegacySessions = await getActiveLegacySessions();
    const nativeSession = await db.readingSessions.get("native-session");

    expect(legacySessions).toHaveLength(2);
    expect(activeLegacySessions).toEqual([
      expect.objectContaining({
        id: legacySessionId("device-a", "book-1", 0),
        activeMs: 700_001,
      }),
    ]);
    expect(
      legacySessions.find(
        (session) =>
          session.id === legacySessionId("device-a", "book-1", 700_001),
      ),
    ).toMatchObject({ isDeleted: true });
    expect(nativeSession).toMatchObject({
      id: "native-session",
      isDeleted: false,
    });
  });
});
