import { generateDexieStores } from "@/lib/sync/hlc/schema";
import { LOCAL_TABLES, SYNC_TABLES } from "@/lib/sync-tables";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIndexedDB } from "../setup/indexeddb";

const DB_NAME = "epub-reader-db";

const {
  readingCheckpoints: _readingCheckpoints,
  readingSessions: _readingSessions,
  ...SYNC_TABLES_BEFORE_V8
} = SYNC_TABLES;
const {
  bookChapterSourceCache: _bookChapterSourceCache,
  ...LOCAL_TABLES_BEFORE_READER_BODY_CACHE
} = LOCAL_TABLES;
const LEGACY_STORES_V7 = {
  ...generateDexieStores(SYNC_TABLES_BEFORE_V8),
  ...LOCAL_TABLES_BEFORE_READER_BODY_CACHE,
};
const LEGACY_STORES_V9 = {
  ...generateDexieStores(SYNC_TABLES),
  ...LOCAL_TABLES_BEFORE_READER_BODY_CACHE,
};

type DbModule = typeof import("@/lib/db");

let currentDbModule: DbModule | undefined;

/**
 * Seed a historical IndexedDB schema so the current Dexie instance must run
 * its real upgrade callbacks when we reopen the database.
 */
async function seedLegacyDatabase(
  version: number,
  stores: Record<string, string>,
  seed: (db: Dexie) => Promise<void>,
): Promise<void> {
  const legacyDb = new Dexie(DB_NAME);
  legacyDb.version(version).stores(stores);
  await legacyDb.open();

  try {
    await seed(legacyDb);
  } finally {
    legacyDb.close();
  }
}

async function openCurrentDatabase(): Promise<DbModule> {
  currentDbModule = await import("@/lib/db");
  await currentDbModule.db.open();
  return currentDbModule;
}

describe("IndexedDB migrations", () => {
  beforeEach(() => {
    resetIndexedDB();
    localStorage.clear();
    currentDbModule = undefined;
    vi.resetModules();
  });

  afterEach(async () => {
    currentDbModule?.db.close();
    currentDbModule = undefined;
    await Dexie.delete(DB_NAME);
    localStorage.clear();
  });

  it("adds the reader body cache during schema upgrade", async () => {
    await seedLegacyDatabase(9, LEGACY_STORES_V9, async () => {});

    const { db } = await openCurrentDatabase();

    await db.bookChapterSourceCache.put({
      bookId: "book-1",
      fileHash: "hash-1",
      cacheVersion: 1,
      chaptersByPath: {},
      updatedAt: Date.now(),
    });
    await expect(db.bookChapterSourceCache.count()).resolves.toBe(1);
  });

  it("does not seed per-device reading checkpoints during schema upgrade", async () => {
    await seedLegacyDatabase(7, LEGACY_STORES_V7, async (legacyDb) => {
      await legacyDb.table("readingProgress").bulkAdd([
        {
          id: "progress-latest",
          bookId: "book-1",
          currentSpineIndex: 5,
          scrollProgress: 0.75,
          lastRead: 200,
          createdAt: 190,
          _hlc: "200-0-device-a",
          _deviceId: "device-a",
          _serverTimestamp: 1000,
          _isDeleted: 0,
        },
      ]);
    });

    const { db } = await openCurrentDatabase();

    const checkpoints = await db.readingCheckpoints.orderBy("id").toArray();

    expect(checkpoints).toEqual([]);
  });
});
