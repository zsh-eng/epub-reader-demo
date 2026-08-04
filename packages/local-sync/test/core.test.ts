import { describe, expect, expectTypeOf, it } from "vitest";
import type { BlobRef } from "../src/blob/index.js";
import {
  compareSyncVersions,
  INITIAL_SYNC_CURSOR,
  type SequencedSyncRecord,
  type SyncBatch,
  type SyncRecord,
  type SyncTablePolicy,
} from "../src/core/index.js";

type BookPayload = {
  title: string;
  cover: BlobRef;
};

const baseRecord = {
  tableName: "books",
  recordId: "book-1",
  hlc: { wallTimeMs: 1_722_732_000_000, counter: 0 },
  deviceId: "device-1",
  schemaVersion: 1,
} as const;

describe("local-sync core contracts", () => {
  it("orders sync versions by HLC components and device ID", () => {
    expect(
      compareSyncVersions(
        { hlc: { wallTimeMs: 10, counter: 0 }, deviceId: "device-z" },
        { hlc: { wallTimeMs: 11, counter: 0 }, deviceId: "device-a" },
      ),
    ).toBe(-1);
    expect(
      compareSyncVersions(
        { hlc: { wallTimeMs: 10, counter: 2 }, deviceId: "device-a" },
        { hlc: { wallTimeMs: 10, counter: 1 }, deviceId: "device-z" },
      ),
    ).toBe(1);
    expect(
      compareSyncVersions(
        { hlc: { wallTimeMs: 10, counter: 2 }, deviceId: "device-b" },
        { hlc: { wallTimeMs: 10, counter: 2 }, deviceId: "device-a" },
      ),
    ).toBe(1);
  });

  it("keeps blob references independent of a storage provider", () => {
    const reference = {
      blobId: "blob-1",
      hash: "sha256:abc123",
      size: 1024,
      mediaType: "image/jpeg",
    } satisfies BlobRef;

    expect(reference).toEqual({
      blobId: "blob-1",
      hash: "sha256:abc123",
      size: 1024,
      mediaType: "image/jpeg",
    });
  });

  it("models a local put without a server sequence", () => {
    const record = {
      ...baseRecord,
      operation: "put",
      payload: {
        title: "Example",
        cover: {
          blobId: "blob-1",
          hash: "sha256:abc123",
          size: 1024,
          mediaType: "image/jpeg",
        },
      },
    } satisfies SyncRecord<BookPayload>;

    expect(record.operation).toBe("put");
    expect(record.payload.title).toBe("Example");
    expect(record.hlc).toEqual({ wallTimeMs: 1_722_732_000_000, counter: 0 });
    expectTypeOf(record).toMatchTypeOf<SyncRecord<BookPayload>>();
  });

  it("retains the domain payload on a tombstone", () => {
    const record = {
      ...baseRecord,
      operation: "delete",
      payload: {
        title: "Example",
        cover: {
          blobId: "blob-1",
          hash: "sha256:abc123",
          size: 1024,
          mediaType: "image/jpeg",
        },
      },
    } satisfies SyncRecord<BookPayload>;

    expect(record.payload.title).toBe("Example");
    expectTypeOf(record).toMatchTypeOf<SyncRecord<BookPayload>>();
  });

  it("adds server ordering only to sequenced records", () => {
    const record = {
      ...baseRecord,
      operation: "delete",
      payload: {
        title: "Example",
        cover: {
          blobId: "blob-1",
          hash: "sha256:abc123",
          size: 1024,
          mediaType: "image/jpeg",
        },
      },
      serverSeq: 42,
    } satisfies SequencedSyncRecord<BookPayload>;

    expect(record.serverSeq).toBe(42);
    expectTypeOf(record).toMatchTypeOf<SequencedSyncRecord<BookPayload>>();
  });

  it("carries catch-up progress on the batch instead of each client request", () => {
    const record = {
      ...baseRecord,
      operation: "delete",
      payload: {
        title: "Example",
        cover: {
          blobId: "blob-1",
          hash: "sha256:abc123",
          size: 1024,
          mediaType: "image/jpeg",
        },
      },
      serverSeq: 42,
    } satisfies SequencedSyncRecord<BookPayload>;
    const batch = {
      records: [record],
      cursor: 42,
      hasMore: false,
    } satisfies SyncBatch<BookPayload>;

    expect(batch.cursor).toBe(42);
    expect(batch.hasMore).toBe(false);
    expect(INITIAL_SYNC_CURSOR).toBe(0);
  });

  it("describes scoped and whole-app table policies", () => {
    const highlights = {
      recordId: "id",
      scopeId: "bookId",
      conflict: "lww",
      schemaVersion: 1,
    } satisfies SyncTablePolicy<"id", "bookId">;
    const settings = {
      recordId: "id",
      conflict: "lww",
      schemaVersion: 1,
    } satisfies SyncTablePolicy<"id">;

    expect(highlights.scopeId).toBe("bookId");
    expect("scopeId" in settings).toBe(false);
  });
});
