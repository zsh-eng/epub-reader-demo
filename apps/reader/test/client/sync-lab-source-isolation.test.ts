import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { captureLocalSeed } from "@/features/sync-lab/core/seed";
import {
  EPUBReaderSyncV2DB,
  SYNC_V2_DATABASE_NAME,
  SYNC_V2_VERSION_3_STORES,
} from "@/lib/sync-v2/db";
import { resetIndexedDB } from "../setup/indexeddb";

afterEach(async () => {
  await Dexie.delete(SYNC_V2_DATABASE_NAME);
});

describe("read-only local library capture", () => {
  it("rejects older source schemas without upgrading or changing rows", async () => {
    resetIndexedDB();
    const source = new Dexie(SYNC_V2_DATABASE_NAME);
    source.version(3).stores(SYNC_V2_VERSION_3_STORES);
    await source.open();
    const book = {
      id: "legacy",
      fileHash: "1111111111111111",
      title: "Original",
    };
    await source.table("books").put(book);
    source.close();
    await expect(captureLocalSeed()).rejects.toThrow("Open Reader");
    const inspect = new Dexie(SYNC_V2_DATABASE_NAME);
    try {
      await inspect.open();
      expect(inspect.verno).toBe(3);
      expect(await inspect.table("books").get("legacy")).toEqual(book);
    } finally {
      inspect.close();
    }
  });

  it("captures domain tombstones and referenced bytes, without local derived data or outbox", async () => {
    resetIndexedDB();
    const source = new EPUBReaderSyncV2DB(SYNC_V2_DATABASE_NAME);
    try {
      await source.open();
      await source
        .table("books")
        .put({
          id: "book",
          sourceFileId: "xxh64:1111111111111111",
          cover: null,
          isDeleted: false,
        });
      await source
        .table("notes")
        .put({ id: "deleted-note", bookId: "book", isDeleted: true });
      await source
        .table("notes")
        .put({ id: "unrelated", bookId: "other", isDeleted: false });
      await source.table("noteDrafts").put({ id: "draft", bookId: "book" });
      await source.table("_sync_outbox").put({ key: "sentinel" });
      await source
        .table("files")
        .put({
          id: "xxh64:1111111111111111",
          blob: new Blob(["source"]),
          size: 6,
        });
      await source
        .table("files")
        .put({
          id: "xxh64:2222222222222222",
          blob: new Blob(["other"]),
          size: 5,
        });
      const seed = await captureLocalSeed();
      expect(seed.rows.notes).toEqual([
        { id: "deleted-note", bookId: "book", isDeleted: true },
      ]);
      expect(seed.rows).not.toHaveProperty("noteDrafts");
      expect(seed.rows).not.toHaveProperty("_sync_outbox");
      expect(seed.files.map((file) => file.id)).toEqual([
        "xxh64:1111111111111111",
      ]);
      expect(await source.table("_sync_outbox").get("sentinel")).toEqual({
        key: "sentinel",
      });
    } finally {
      source.close();
    }
  });
});
