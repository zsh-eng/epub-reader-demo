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
const { bookImageDimensions: _bookImageDimensions, ...LOCAL_TABLES_BEFORE_V7 } =
  LOCAL_TABLES;

const LEGACY_STORES_V6 = {
  ...generateDexieStores(SYNC_TABLES_BEFORE_V8),
  ...LOCAL_TABLES_BEFORE_V7,
};

const LEGACY_STORES_V7 = {
  ...generateDexieStores(SYNC_TABLES_BEFORE_V8),
  ...LOCAL_TABLES,
};

type DbModule = typeof import("@/lib/db");

let currentDbModule: DbModule | undefined;

if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => {
        reject(reader.error ?? new Error("Failed to read blob"));
      };
      reader.onload = () => {
        resolve(reader.result as ArrayBuffer);
      };

      reader.readAsArrayBuffer(this);
    });
  };
}

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

function createPngBlob(width: number, height: number): Blob {
  const bytes = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52,
    ...toUint32Bytes(width),
    ...toUint32Bytes(height),
  ]);

  return new Blob([bytes], { type: "image/png" });
}

function toUint32Bytes(value: number): [number, number, number, number] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
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
    vi.doUnmock("@/lib/image-dimensions");
  });

  it("backfills book image dimensions when upgrading from schema version 6", async () => {
    const bookId = "book-1";
    const imagePath = "OPS/images/hero.png";

    vi.doMock("@/lib/image-dimensions", () => ({
      extractImageDimensionsFromBlob: vi.fn(
        async (_blob: Blob, mediaType?: string) => {
          if (mediaType !== "image/png") return null;
          return { width: 37, height: 19 };
        },
      ),
    }));

    await seedLegacyDatabase(6, LEGACY_STORES_V6, async (legacyDb) => {
      await legacyDb.table("bookFiles").bulkAdd([
        {
          id: "file-image",
          bookId,
          path: imagePath,
          content: createPngBlob(37, 19),
          mediaType: "image/png",
        },
        {
          id: "file-chapter",
          bookId,
          path: "OPS/chapter-1.xhtml",
          content: new Blob(["<html></html>"], {
            type: "application/xhtml+xml",
          }),
          mediaType: "application/xhtml+xml",
        },
      ]);
    });

    const { db, createBookImageDimensionId } = await openCurrentDatabase();

    const dimensions = await db.bookImageDimensions.toArray();

    expect(dimensions).toHaveLength(1);
    expect(dimensions[0]).toMatchObject({
      id: createBookImageDimensionId(bookId, imagePath),
      bookId,
      path: imagePath,
      width: 37,
      height: 19,
    });
    expect(dimensions[0]?.updatedAt).toEqual(expect.any(Number));
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
