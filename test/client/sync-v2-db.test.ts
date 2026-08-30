import {
  deleteLegacyClientDatabase,
  EPUBReaderSyncV2DB,
  SYNC_V2_VERSION_1_STORES,
  SYNC_V2_VERSION_2_STORES,
} from "@/lib/sync-v2/db";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { resetIndexedDB } from "../setup/indexeddb";

const DATABASE_NAME = "sync-v2-schema-upgrade-test";

describe("sync v2 database schema", () => {
  afterEach(async () => {
    await Dexie.delete(DATABASE_NAME);
  });

  it("removes the local readingProgress table during the version 2 upgrade", async () => {
    resetIndexedDB();
    const legacyDb = new Dexie(DATABASE_NAME);
    legacyDb.version(1).stores(SYNC_V2_VERSION_1_STORES);
    await legacyDb.open();
    await legacyDb.table("books").add({
      id: "book-a",
      fileHash: "hash-a",
      title: "Book A",
      author: "Author",
      fileSize: 1,
      dateAdded: 1,
      metadata: {},
      manifest: [],
      spine: [],
      toc: [],
      isDownloaded: 1,
      isDeleted: false,
    });
    await legacyDb.table("readingProgress").add({
      id: "progress-a",
      bookId: "book-a",
      lastRead: 1,
    });
    legacyDb.close();

    const migratedDb = new EPUBReaderSyncV2DB(DATABASE_NAME);
    await migratedDb.open();

    expect(migratedDb.tables.map((table) => table.name)).not.toContain(
      "readingProgress",
    );
    expect(await migratedDb.books.get("book-a")).toMatchObject({
      id: "book-a",
      title: "Book A",
    });
    migratedDb.close();
  });

  it("migrates opaque local files and replaces the transfer queue", async () => {
    resetIndexedDB();
    const remoteHash = "1111111111111111";
    const pendingHash = "2222222222222222";
    const legacyDb = new Dexie(DATABASE_NAME);
    legacyDb.version(2).stores(SYNC_V2_VERSION_2_STORES);
    await legacyDb.open();

    const sharedBlob = new Blob(["shared bytes"], { type: "text/plain" });
    await legacyDb.table("files").bulkAdd([
      {
        id: `epub:${remoteHash}`,
        contentHash: remoteHash,
        fileType: "epub",
        blob: sharedBlob,
        mediaType: "application/epub+zip",
        size: sharedBlob.size,
        storedAt: 1,
      },
      {
        id: `cover:${remoteHash}`,
        contentHash: remoteHash,
        fileType: "cover",
        blob: sharedBlob,
        mediaType: "text/plain",
        size: sharedBlob.size,
        storedAt: 2,
      },
      {
        id: `epub:${pendingHash}`,
        contentHash: pendingHash,
        fileType: "epub",
        blob: new Blob(["pending bytes"]),
        mediaType: "application/epub+zip",
        size: 13,
        storedAt: 3,
      },
    ]);
    await legacyDb.table("transferQueue").bulkAdd([
      {
        id: "completed-download",
        direction: "download",
        contentHash: remoteHash,
        fileType: "epub",
        status: "completed",
        priority: 5,
        createdAt: 4,
        retryCount: 0,
        maxRetries: 3,
      },
      {
        id: "failed-upload",
        direction: "upload",
        contentHash: pendingHash,
        fileType: "epub",
        status: "failed",
        priority: 5,
        createdAt: 5,
        retryCount: 2,
        maxRetries: 3,
        lastAttempt: 6,
        error: "Offline",
      },
    ]);
    legacyDb.close();

    const migratedDb = new EPUBReaderSyncV2DB(DATABASE_NAME);
    await migratedDb.open();

    expect(migratedDb.tables.map((table) => table.name)).not.toContain(
      "transferQueue",
    );
    expect(migratedDb.tables.map((table) => table.name)).toContain(
      "fileUploadOperations",
    );
    expect(await migratedDb.files.toArray()).toMatchObject([
      {
        id: `xxh64:${remoteHash}`,
        blob: { type: "text/plain" },
        mediaType: "text/plain",
        size: sharedBlob.size,
        storedAt: 2,
        remotePresent: true,
      },
      {
        id: `xxh64:${pendingHash}`,
        blob: { type: "" },
        mediaType: "application/epub+zip",
        size: 13,
        storedAt: 3,
        remotePresent: false,
      },
    ]);
    expect(await migratedDb.fileUploadOperations.toArray()).toEqual([
      {
        id: `xxh64:${pendingHash}`,
        createdAt: 5,
        retryCount: 2,
        lastFailure: {
          kind: "failed",
          message: "Offline",
          failedAt: 6,
        },
      },
    ]);
    migratedDb.close();
  });

  it("deletes the pre-v2 client database", async () => {
    resetIndexedDB();
    const legacyDb = new Dexie("epub-reader-db");
    legacyDb.version(1).stores({ books: "id" });
    await legacyDb.open();
    await legacyDb.table("books").add({ id: "legacy-book" });
    legacyDb.close();

    await deleteLegacyClientDatabase();

    expect(await Dexie.exists("epub-reader-db")).toBe(false);
  });
});
