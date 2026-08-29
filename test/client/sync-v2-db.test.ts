import {
  deleteLegacyClientDatabase,
  EPUBReaderSyncV2DB,
  SYNC_V2_STORES,
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
    legacyDb.version(1).stores({
      ...SYNC_V2_STORES,
      readingProgress: "id, bookId, lastRead, [bookId+lastRead]",
    });
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
