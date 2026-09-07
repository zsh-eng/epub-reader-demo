import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  serializeLabSnapshot,
  deserializeLabSnapshot,
  validateLabSnapshot,
} from "@/features/sync-lab/core/snapshot-file";
import type { LabSnapshot } from "@/features/sync-lab/core/controller";
import { computeFileId } from "@/lib/files/file-id";
import { createSyncClientState } from "@/lib/sync-v2/client-state";
import { SYNC_CLIENT_STATE_STORAGE_KEY } from "@/lib/sync-v2/protocol";

beforeEach(() => vi.stubGlobal("Blob", NodeBlob));
afterEach(() => vi.unstubAllGlobals());
function fixture(): LabSnapshot {
  return {
    version: 1,
    name: "Before reconnect",
    capturedAt: 100,
    elapsedMs: 0,
    server: { nextSequence: 1, records: [], files: [] },
    clients: [
      {
        id: "lab-client-a",
        name: "Client A",
        preset: "empty",
        storage: {
          [SYNC_CLIENT_STATE_STORAGE_KEY]: JSON.stringify(
            createSyncClientState("lab-client-a"),
          ),
        },
        network: {
          online: false,
          latencyMs: 20,
          failNext: false,
          loseNextResponse: true,
        },
        clockOffset: 0,
        database: {},
      },
    ],
  };
}

describe("Sync Lab snapshot files", () => {
  it("round trips binary bytes, cache maps, undefined fields and network controls", async () => {
    const snapshot = fixture();
    const blob = new Blob([new Uint8Array([0, 128, 255, 42])], {
      type: "application/epub+zip",
    });
    const id = await computeFileId(blob);
    snapshot.server.files = [
      {
        metadata: {
          id,
          fileSize: blob.size,
          mediaType: blob.type,
          createdAt: 100,
        },
        blob,
      },
    ];
    snapshot.clients[0]!.database = {
      bookChapterSourceCache: [
        {
          bookId: "book-a",
          map: new Map([["paragraph-1", 100]]),
          optional: undefined,
        },
      ],
      files: [{ id, blob, size: blob.size }],
    };
    const restored = await deserializeLabSnapshot(
      await serializeLabSnapshot(snapshot),
    );
    expect(restored.clients[0]?.network).toEqual(snapshot.clients[0]?.network);
    expect(
      new Uint8Array(await restored.server.files[0]!.blob.arrayBuffer()),
    ).toEqual(new Uint8Array([0, 128, 255, 42]));
    expect(restored.clients[0]?.database.bookChapterSourceCache).toEqual(
      snapshot.clients[0]?.database.bookChapterSourceCache,
    );
  });
  it("rejects tables, duplicate clients, invalid identities and out of bounds cursors", () => {
    const unknown = fixture();
    unknown.clients[0]!.database.credentials = [];
    expect(() => validateLabSnapshot(unknown)).toThrow(
      "Unknown database table",
    );
    const duplicate = fixture();
    duplicate.clients.push(duplicate.clients[0]!);
    expect(() => validateLabSnapshot(duplicate)).toThrow("Duplicate client");
    const identity = fixture();
    identity.clients[0]!.id = "production-device";
    expect(() => validateLabSnapshot(identity)).toThrow();
    const cursor = fixture();
    cursor.clients[0]!.storage[SYNC_CLIENT_STATE_STORAGE_KEY] = JSON.stringify({
      ...createSyncClientState("lab-client-a"),
      pullCursor: 1,
    });
    expect(() => validateLabSnapshot(cursor)).toThrow("cursor");
  });
  it("rejects malformed envelopes and malformed encoded objects", async () => {
    await expect(deserializeLabSnapshot('{"version":1}')).rejects.toThrow();
    await expect(
      deserializeLabSnapshot(
        JSON.stringify({
          format: "reader-sync-lab",
          version: 1,
          payload: { type: "object", value: [["__proto__", {}]] },
        }),
      ),
    ).rejects.toThrow();
  });
  it("rejects content hash mismatch before handing a snapshot to restore", async () => {
    const snapshot = fixture();
    const blob = new Blob(["first"]);
    const id = await computeFileId(blob);
    snapshot.server.files = [
      {
        metadata: { id, fileSize: 5, mediaType: "", createdAt: 100 },
        blob: new Blob(["wrong"]),
      },
    ];
    await expect(
      deserializeLabSnapshot(await serializeLabSnapshot(snapshot)),
    ).rejects.toThrow("file ID");
  });
});
