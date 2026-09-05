import { subscribeToQueryInvalidation } from "@/lib/query-invalidation";
import { getOrCreateSyncClientState } from "@/lib/sync-v2/client-state";
import {
  createSyncV2ApplicationDb,
  EPUBReaderSyncV2DB,
} from "@/lib/sync-v2/db";
import { encodeSyncKey, encodeSyncValue } from "@/lib/sync-v2/protocol";
import { SyncV2Client, type SyncV2Remote } from "@/lib/sync-v2/sync";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIndexedDB } from "../setup/indexeddb";

const DATABASE_NAME = "query-invalidation-test";
const QUERY_KEYS = {
  library: ["books", "list", "readingStatus", "all"],
  book: ["books", "book-a"],
  checkpoint: ["readingCheckpoint", "currentDevice", "book-a"],
  checkpoints: ["readingCheckpoints", "book", "book-a"],
  sessions: ["readingSessions", "overview"],
  status: ["readingStatus", "book-a"],
  statuses: ["readingStatus", "all"],
  highlights: ["highlights", "book-a"],
  allHighlights: ["highlights", "all"],
  notes: ["notes", "annotation", "highlight-a"],
  chapterNotes: ["notes", "chapter", "book-a", "chapter-a"],
  body: ["readerBodyCache", 6, "book-a"],
  artifact: ["readerChapterArtifact", 1, 6, "book-a"],
  preparation: ["epubPreparation", "book-a"],
  authSessions: ["sessions"],
};

const readingState = {
  id: "status-a",
  bookId: "book-a",
  status: "reading" as const,
  timestamp: 1_000,
  createdAt: 1_000,
  isDeleted: false,
};

describe("database query invalidation", () => {
  let db: EPUBReaderSyncV2DB;
  let syncDb: EPUBReaderSyncV2DB;
  let queryClient: QueryClient;
  let unsubscribe: () => void;

  beforeEach(async () => {
    resetIndexedDB();
    localStorage.clear();
    getOrCreateSyncClientState("device-a");
    db = createSyncV2ApplicationDb(DATABASE_NAME);
    syncDb = new EPUBReaderSyncV2DB(DATABASE_NAME);
    await Promise.all([db.open(), syncDb.open()]);
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    warmQueries();
    unsubscribe = subscribeToQueryInvalidation(queryClient, DATABASE_NAME);
  });

  afterEach(async () => {
    unsubscribe();
    queryClient.clear();
    syncDb.close();
    await db.delete();
    db.close();
    localStorage.clear();
  });

  function warmQueries() {
    for (const key of Object.values(QUERY_KEYS)) {
      queryClient.setQueryData(key, { cached: true });
    }
  }

  function invalidatedQueries() {
    return Object.entries(QUERY_KEYS)
      .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
      .map(([name]) => name)
      .sort();
  }

  it("refreshes checkpoint views after a local write without touching Reader caches", async () => {
    const body = queryClient.getQueryData(QUERY_KEYS.body);
    await db.readingCheckpoints.put({
      id: "resume:device-a:book-a",
      bookId: "book-a",
      deviceId: "device-a",
      currentSpineIndex: 2,
      scrollProgress: 50,
      lastRead: 1_000,
      isDeleted: false,
    });

    await vi.waitFor(() => {
      expect(invalidatedQueries()).toEqual([
        "checkpoint",
        "checkpoints",
        "library",
      ]);
    });
    expect(queryClient.getQueryData(QUERY_KEYS.body)).toBe(body);
    expect(await db._sync_outbox.count()).toBe(1);
  });

  it("refreshes combined views when book metadata changes on the raw sync connection", async () => {
    // A partial row is sufficient here: the raw connection has no Book validator.
    await syncDb.table("books").put({ id: "book-a", title: "New title" });
    await vi.waitFor(() => {
      expect(invalidatedQueries()).toEqual([
        "allHighlights",
        "book",
        "library",
        "sessions",
      ]);
    });
  });

  it("batches multiple table and index changes into one invalidation after commit", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await syncDb.transaction(
      "rw",
      [syncDb.highlights, syncDb.notes],
      async () => {
        await syncDb
          .table("highlights")
          .put({ id: "highlight-a", bookId: "book-a" });
        await syncDb.table("notes").put({ id: "note-a", bookId: "book-a" });
        expect(invalidate).not.toHaveBeenCalled();
      },
    );

    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(invalidatedQueries()).toEqual([
      "allHighlights",
      "chapterNotes",
      "highlights",
      "notes",
    ]);
  });

  it("refetches an active query from committed data", async () => {
    const readStatus = vi.fn(
      async () =>
        (await db.readingState.get(readingState.id))?.status ?? "missing",
    );
    const observer = new QueryObserver(queryClient, {
      queryKey: QUERY_KEYS.status,
      queryFn: readStatus,
    });
    const stop = observer.subscribe(() => undefined);
    try {
      await syncDb.readingState.put(readingState);
      await vi.waitFor(() => {
        expect(queryClient.getQueryData(QUERY_KEYS.status)).toBe("reading");
      });
      expect(readStatus).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryState(QUERY_KEYS.body)?.isInvalidated).toBe(
        false,
      );
    } finally {
      stop();
    }
  });

  it("invalidates session statistics without reloading book content", async () => {
    await syncDb.table("readingSessions").put({
      id: "session-a",
      bookId: "book-a",
      activeMs: 5_000,
    });
    await vi.waitFor(() => {
      expect(invalidatedQueries()).toEqual(["sessions"]);
    });
  });

  it("refreshes highlight views after a local soft deletion", async () => {
    await syncDb.table("highlights").put({
      id: "highlight-a",
      bookId: "book-a",
      isDeleted: false,
    });
    await vi.waitFor(() =>
      expect(invalidatedQueries()).toContain("highlights"),
    );
    warmQueries();

    await db.highlights.delete("highlight-a");
    await vi.waitFor(() => {
      expect(invalidatedQueries()).toEqual(["allHighlights", "highlights"]);
    });
    expect((await syncDb.highlights.get("highlight-a"))?.isDeleted).toBe(true);
  });

  it("ignores writes to a different database", async () => {
    const otherDb = new EPUBReaderSyncV2DB(`${DATABASE_NAME}-other`);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    try {
      await otherDb.readingState.put(readingState);
      await nextTask();
      expect(invalidate).not.toHaveBeenCalled();
    } finally {
      await otherDb.delete();
    }
  });

  it("does not invalidate queries for upload acknowledgements", async () => {
    await db.readingState.put(readingState);
    await vi.waitFor(() => expect(invalidatedQueries()).toContain("status"));
    warmQueries();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const client = new SyncV2Client({ syncDb, remote: echoRemote() });

    await expect(client.sync()).resolves.toEqual({
      pulled: 0,
      skipped: 0,
      pushed: 1,
    });
    await nextTask();
    expect(await db._sync_outbox.count()).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
    expect(invalidatedQueries()).toEqual([]);
  });

  it("refreshes a remote push winner that replaces local data", async () => {
    await db.readingState.put(readingState);
    await vi.waitFor(() => expect(invalidatedQueries()).toContain("status"));
    warmQueries();
    const remote = echoRemote();
    remote.push = async (_deviceId, changes) => ({
      results: changes.map((change) => ({
        accepted: false,
        winner: {
          ...change,
          value: encodeSyncValue({ ...readingState, status: "finished" }),
          hlc: { wallTimeMs: change.hlc.wallTimeMs + 1, counter: 0 },
          deviceId: "device-b",
          serverSeq: 1,
        },
      })),
    });

    await new SyncV2Client({ syncDb, remote }).sync();
    await vi.waitFor(() => {
      expect(invalidatedQueries()).toEqual(["library", "status", "statuses"]);
    });
    expect((await db.readingState.get(readingState.id))?.status).toBe(
      "finished",
    );
  });

  it("keeps a committed pull visible when the next page fails", async () => {
    const remote = echoRemote();
    remote.pull = async (_deviceId, request) => {
      if (request.cursor > 0) throw new Error("Network failed");
      return {
        records: [
          {
            key: encodeSyncKey("readingState", readingState.id),
            value: encodeSyncValue(readingState),
            schemaVersion: 1,
            hlc: { wallTimeMs: 100, counter: 0 },
            deviceId: "device-b",
            isDeleted: false,
            serverSeq: 1,
          },
        ],
        cursor: 1,
        head: 2,
        hasMore: true,
      };
    };

    await expect(new SyncV2Client({ syncDb, remote }).sync()).rejects.toThrow(
      "Network failed",
    );
    await vi.waitFor(() => {
      expect(invalidatedQueries()).toEqual(["library", "status", "statuses"]);
    });
    expect(await db.readingState.get(readingState.id)).toEqual(readingState);
  });

  it("ignores aborted transactions, derived data, and writes after unsubscribe", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await expect(
      syncDb.transaction("rw", syncDb.readingState, async () => {
        await syncDb.readingState.put(readingState);
        throw new Error("Abort");
      }),
    ).rejects.toThrow("Abort");
    await syncDb.table("bookChapterSourceCache").put({ bookId: "book-a" });
    await nextTask();
    expect(invalidate).not.toHaveBeenCalled();

    unsubscribe();
    await syncDb.readingState.put(readingState);
    await nextTask();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

function echoRemote(): SyncV2Remote {
  return {
    pull: async (_deviceId, request) => ({
      records: [],
      cursor: request.cursor,
      head: request.cursor,
      hasMore: false,
    }),
    push: async (deviceId, changes) => ({
      results: changes.map((change, index) => ({
        accepted: true,
        winner: { ...change, deviceId, serverSeq: index + 1 },
      })),
    }),
  };
}

function nextTask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
