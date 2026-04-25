import {
  backfillLegacyReadingProgressSessions,
  db,
  LEGACY_READING_PROGRESS_SESSION_SOURCE,
  READER_V2_READING_SESSION_SOURCE,
  type Book,
  type ReadingSession,
  type SyncedBook,
  type SyncedReadingProgress,
  type SyncedReadingSession,
} from "@/lib/db";
import { beforeEach, describe, expect, it } from "vitest";

const LEGACY_SESSION_ID_PREFIX = `${LEGACY_READING_PROGRESS_SESSION_SOURCE}:v1:`;

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

function makeSession(
  overrides: Partial<ReadingSession> & { id: string },
): SyncedReadingSession {
  return {
    id: overrides.id,
    bookId: overrides.bookId ?? "book-1",
    deviceId: overrides.deviceId ?? "device-a",
    readerInstanceId: overrides.readerInstanceId ?? "reader-1",
    source: overrides.source ?? READER_V2_READING_SESSION_SOURCE,
    startedAt: overrides.startedAt ?? 0,
    endedAt: overrides.endedAt ?? null,
    lastActiveAt: overrides.lastActiveAt ?? 0,
    activeMs: overrides.activeMs ?? 0,
    startSpineIndex: overrides.startSpineIndex ?? 0,
    startScrollProgress: overrides.startScrollProgress ?? 0,
    endSpineIndex: overrides.endSpineIndex ?? 0,
    endScrollProgress: overrides.endScrollProgress ?? 0,
    _hlc: "0-0-test",
    _deviceId: "test-device",
    _serverTimestamp: 0,
    _isDeleted: 0,
  };
}

function legacySessionId(
  deviceId: string,
  bookId: string,
  startedAt: number,
): string {
  return `${LEGACY_SESSION_ID_PREFIX}${deviceId}:${bookId}:${startedAt}`;
}

async function getLegacySessions(): Promise<SyncedReadingSession[]> {
  return db.readingSessions
    .filter(
      (session) => session.source === LEGACY_READING_PROGRESS_SESSION_SOURCE,
    )
    .toArray();
}

async function getActiveLegacySessions(): Promise<SyncedReadingSession[]> {
  return db.readingSessions
    .filter(
      (session) =>
        session.source === LEGACY_READING_PROGRESS_SESSION_SOURCE &&
        session._isDeleted !== 1,
    )
    .toArray();
}

describe("legacy reading progress session backfill", () => {
  beforeEach(async () => {
    await db.readingSessions.clear();
    await db.readingProgress.clear();
    await db.books.clear();
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
        _isDeleted: 1,
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
      source: LEGACY_READING_PROGRESS_SESSION_SOURCE,
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
        source: LEGACY_READING_PROGRESS_SESSION_SOURCE,
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
        _isDeleted: 0,
      }),
    ]);
  });

  it("reruns by soft-deleting previous legacy imports before inserting the recomputed set", async () => {
    await db.books.add(makeBook("book-1"));
    await db.readingSessions.add(
      makeSession({
        id: "native-session",
        source: READER_V2_READING_SESSION_SOURCE,
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
    ).toMatchObject({ _isDeleted: 1 });
    expect(nativeSession).toMatchObject({
      id: "native-session",
      source: READER_V2_READING_SESSION_SOURCE,
      _isDeleted: 0,
    });
  });
});
