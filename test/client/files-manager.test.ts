import { db } from "@/lib/db";
import { computeFileId } from "@/lib/files/file-id";
import { FileManager } from "@/lib/files/file-manager";
import {
  FileRemoteRequestError,
  type FileRemoteApi,
} from "@/lib/files/file-remote-api";
import { FilesManager } from "@/lib/files/files-manager";
import type { FileId, RemoteFile } from "@/lib/files/types";
import { beforeEach, describe, expect, it } from "vitest";

async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for condition");
}

class MockFileRemoteApi implements FileRemoteApi {
  readonly files = new Map<FileId, Blob>();
  putCalls = 0;
  getCalls = 0;
  deleteCalls = 0;
  failPuts = false;
  getDelayMs = 0;

  async put(id: FileId, blob: Blob, mediaType: string): Promise<RemoteFile> {
    this.putCalls += 1;
    if (this.failPuts) throw new Error("Mock upload failed");

    this.files.set(id, new Blob([blob], { type: mediaType }));
    return {
      id,
      fileSize: blob.size,
      mediaType,
      createdAt: Date.now(),
    };
  }

  async get(id: FileId): Promise<Blob> {
    this.getCalls += 1;
    if (this.getDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.getDelayMs));
    }

    const blob = this.files.get(id);
    if (!blob) throw new FileRemoteRequestError("File not found", 404);
    return blob;
  }

  async list(): Promise<RemoteFile[]> {
    return [...this.files.entries()].map(([id, blob]) => ({
      id,
      fileSize: blob.size,
      mediaType: blob.type,
      createdAt: 1,
    }));
  }

  async delete(id: FileId): Promise<void> {
    this.deleteCalls += 1;
    if (!this.files.delete(id)) {
      throw new FileRemoteRequestError("File not found", 404);
    }
  }
}

describe("FilesManager", () => {
  beforeEach(async () => {
    await db.fileUploadOperations.clear();
    await db.files.clear();
  });

  it("calculates a stable opaque xxHash ID", async () => {
    const blob = new Blob(["stable content"]);
    const firstId = await computeFileId(blob);
    const secondId = await computeFileId(blob);

    expect(firstId).toBe(secondId);
    expect(firstId).toMatch(/^xxh64:[0-9a-f]{16}$/);
  });

  it("stores bytes and upload intent before put resolves", async () => {
    const remote = new MockFileRemoteApi();
    const manager = new FilesManager(remote);
    const blob = new Blob(["local first"], { type: "text/plain" });

    const id = await manager.put(blob);
    const storedFile = await db.files.get(id);
    const operation = await db.fileUploadOperations.get(id);

    expect(storedFile).toMatchObject({
      id,
      mediaType: "text/plain",
      size: blob.size,
      remotePresent: false,
    });
    expect(storedFile?.blob).toBeDefined();
    expect(operation).toMatchObject({
      id,
      retryCount: 0,
      lastFailure: { kind: "none" },
    });
    expect(remote.putCalls).toBe(0);

    expect(await manager.put(blob)).toBe(id);
    expect(await db.files.count()).toBe(1);
    expect(await db.fileUploadOperations.count()).toBe(1);
  });

  it("uploads durable operations when processing resumes", async () => {
    const remote = new MockFileRemoteApi();
    const manager = new FilesManager(remote);
    const blob = new Blob(["upload later"], { type: "text/plain" });
    const id = await manager.put(blob);

    manager.resumeUploads();
    await waitForCondition(() => remote.files.has(id));

    expect(remote.putCalls).toBe(1);
    expect(await db.fileUploadOperations.get(id)).toBeUndefined();
    expect(await db.files.get(id)).toMatchObject({ remotePresent: true });
    manager.pauseUploads();
  });

  it("resumes an upload operation after a new manager starts", async () => {
    const remote = new MockFileRemoteApi();
    const firstManager = new FilesManager(remote);
    const blob = new Blob(["persisted operation"]);
    const id = await firstManager.put(blob);

    const restoredManager = new FilesManager(remote);
    restoredManager.resumeUploads();
    await waitForCondition(() => remote.files.has(id));

    expect(await db.fileUploadOperations.get(id)).toBeUndefined();
    restoredManager.pauseUploads();
  });

  it("retains a failed operation and retries on the next resume", async () => {
    const remote = new MockFileRemoteApi();
    remote.failPuts = true;
    const manager = new FilesManager(remote);
    manager.resumeUploads();

    const id = await manager.put(new Blob(["retry upload"]));
    await waitForCondition(async () => {
      const operation = await db.fileUploadOperations.get(id);
      return operation?.lastFailure.kind === "failed";
    });

    expect(await db.fileUploadOperations.get(id)).toMatchObject({
      retryCount: 1,
      lastFailure: { kind: "failed", message: "Mock upload failed" },
    });

    remote.failPuts = false;
    manager.resumeUploads();
    await waitForCondition(
      async () => (await db.fileUploadOperations.get(id)) === undefined,
    );
    expect(remote.files.has(id)).toBe(true);
    manager.pauseUploads();
  });

  it("returns local bytes without a remote request", async () => {
    const remote = new MockFileRemoteApi();
    const manager = new FilesManager(remote);
    const blob = new Blob(["local bytes"], { type: "text/plain" });
    const id = await manager.put(blob);

    expect(await manager.get(id)).toEqual((await db.files.get(id))?.blob);
    expect(remote.getCalls).toBe(0);
    expect(await manager.hasLocal(id)).toBe(true);
  });

  it("shares a foreground download and stores it as remote", async () => {
    const remote = new MockFileRemoteApi();
    remote.getDelayMs = 30;
    const manager = new FilesManager(remote);
    const blob = new Blob(["remote bytes"], { type: "text/plain" });
    const id = await computeFileId(blob);
    remote.files.set(id, blob);

    const [first, second] = await Promise.all([
      manager.get(id),
      manager.get(id),
    ]);

    expect(await first.text()).toBe("remote bytes");
    expect(await second.text()).toBe("remote bytes");
    expect(remote.getCalls).toBe(1);
    expect(await db.files.get(id)).toMatchObject({
      id,
      remotePresent: true,
    });
    expect(await db.fileUploadOperations.get(id)).toBeUndefined();
  });

  it("lists files and keeps local bytes after remote deletion", async () => {
    const remote = new MockFileRemoteApi();
    const manager = new FilesManager(remote);
    const blob = new Blob(["retained bytes"], { type: "text/plain" });
    const id = await computeFileId(blob);
    remote.files.set(id, blob);

    await manager.ensureLocal(id);
    expect(await manager.listLocal()).toHaveLength(1);
    expect(await manager.listRemote()).toEqual([
      {
        id,
        fileSize: blob.size,
        mediaType: "text/plain",
        createdAt: 1,
      },
    ]);

    await manager.deleteRemote(id);
    expect(remote.deleteCalls).toBe(1);
    expect(await db.files.get(id)).toMatchObject({
      id,
      remotePresent: false,
    });
    expect(await db.fileUploadOperations.get(id)).toBeUndefined();

    await manager.put(blob);
    expect(await db.fileUploadOperations.get(id)).toBeDefined();
  });

  it("keeps the legacy Book facade on the new storage path", async () => {
    const remote = new MockFileRemoteApi();
    const manager = new FilesManager(remote);
    const legacyManager = new FileManager(manager);
    const blob = new Blob(["legacy facade"], { type: "text/plain" });
    const id = await computeFileId(blob);
    const contentHash = id.slice("xxh64:".length);

    await legacyManager.queueUpload(contentHash, "epub", blob);
    const result = await legacyManager.getFile(contentHash, "epub");

    expect(result.fromCache).toBe(true);
    expect(result.mediaType).toBe("text/plain");
  });

  it("adds the EPUB media type for legacy untyped Blobs", async () => {
    const remote = new MockFileRemoteApi();
    const manager = new FilesManager(remote);
    const legacyManager = new FileManager(manager);
    const blob = new Blob(["untyped EPUB"]);
    const id = await computeFileId(blob);
    const contentHash = id.slice("xxh64:".length);

    await legacyManager.queueUpload(contentHash, "epub", blob);
    const result = await legacyManager.getFile(contentHash, "epub");

    expect(result.mediaType).toBe("application/epub+zip");
    expect(await db.files.get(id)).toMatchObject({
      mediaType: "application/epub+zip",
    });
  });
});
