import { db } from "@/lib/db";
import { computeFileId } from "@/lib/files/file-id";
import {
  FileRemoteRequestError,
  type FileRemoteApi,
} from "@/lib/files/file-remote-api";
import { FilesManager } from "@/lib/files/files-manager";
import type { FileId, RemoteFile } from "@/lib/files/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const managers: FilesManager[] = [];
function createManager(remote: FileRemoteApi): FilesManager {
  const manager = new FilesManager(remote);
  managers.push(manager);
  return manager;
}
afterEach(() => {
  for (const manager of managers.splice(0)) manager.pauseUploads();
});

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
    const manager = createManager(remote);
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
    const manager = createManager(remote);
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
    const firstManager = createManager(remote);
    const blob = new Blob(["persisted operation"]);
    const id = await firstManager.put(blob);

    const restoredManager = createManager(remote);
    restoredManager.resumeUploads();
    await waitForCondition(() => remote.files.has(id));

    expect(await db.fileUploadOperations.get(id)).toBeUndefined();
    restoredManager.pauseUploads();
  });

  it("retains a failed operation and retries after remote recovery without reconnect", async () => {
    const remote = new MockFileRemoteApi();
    remote.failPuts = true;
    const manager = createManager(remote);
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
    await waitForCondition(
      async () => (await db.fileUploadOperations.get(id)) === undefined,
      2500,
    );
    expect(remote.files.has(id)).toBe(true);
    manager.pauseUploads();
  });

  it("returns local bytes without a remote request", async () => {
    const remote = new MockFileRemoteApi();
    const manager = createManager(remote);
    const blob = new Blob(["local bytes"], { type: "text/plain" });
    const id = await manager.put(blob);

    expect(await manager.get(id)).toEqual((await db.files.get(id))?.blob);
    expect(remote.getCalls).toBe(0);
    expect(await manager.hasLocal(id)).toBe(true);
  });

  it("shares a foreground download and stores it as remote", async () => {
    const remote = new MockFileRemoteApi();
    remote.getDelayMs = 30;
    const manager = createManager(remote);
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
    const manager = createManager(remote);
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
});

describe("upload retry lifetime", () => {
  let manager: FilesManager;
  afterEach(() => {
    manager.pauseUploads();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it("backs off, caps the delay, and cancels the timer on pause", async () => {
    await db.fileUploadOperations.clear();
    await db.files.clear();
    const remote = new MockFileRemoteApi();
    remote.failPuts = true;
    manager = createManager(remote);
    await manager.put(new Blob(["backoff"]));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const timers = vi.spyOn(globalThis, "setTimeout");
    manager.resumeUploads();
    await vi.waitFor(() => expect(remote.putCalls).toBe(1));
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const calls = remote.putCalls;
      await vi.waitFor(() =>
        expect(
          timers.mock.calls
            .filter((call) => Number(call[1]) >= 1000)
            .at(-1)?.[1],
        ).toBe(delay),
      );
      await vi.advanceTimersToNextTimerAsync();
      await vi.waitFor(() => expect(remote.putCalls).toBe(calls + 1));
    }
    manager.pauseUploads();
    await vi.advanceTimersByTimeAsync(60000);
    expect(vi.getTimerCount()).toBe(0);
    expect(await db.fileUploadOperations.count()).toBe(1);
  });
  it("does not overlap uploads or bypass backoff when work is added", async () => {
    await db.fileUploadOperations.clear();
    await db.files.clear();
    const remote = new MockFileRemoteApi();
    const pending = Promise.withResolvers<RemoteFile>();
    const put = vi
      .spyOn(remote, "put")
      .mockImplementationOnce(() => pending.promise);
    manager = createManager(remote);
    await manager.put(new Blob(["first"]));
    manager.resumeUploads();
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
    await manager.put(new Blob(["second"]));
    manager.resumeUploads();
    expect(put).toHaveBeenCalledOnce();
    pending.reject(new Error("Temporary failure"));
    await vi.waitFor(async () =>
      expect(
        (await db.fileUploadOperations.toArray()).some(
          (op) => op.retryCount === 1,
        ),
      ).toBe(true),
    );
    expect(put).toHaveBeenCalledOnce();
    await waitForCondition(
      async () => (await db.fileUploadOperations.count()) === 0,
      2500,
    );
    expect(put).toHaveBeenCalledTimes(3);
  });
});

it("does not schedule a retry when an in-flight upload fails after pause", async () => {
  await db.fileUploadOperations.clear();
  await db.files.clear();
  const remote = new MockFileRemoteApi();
  const pending = Promise.withResolvers<RemoteFile>();
  const put = vi.spyOn(remote, "put").mockImplementation(() => pending.promise);
  const manager = createManager(remote);
  const id = await manager.put(new Blob(["pause during request"]));
  manager.resumeUploads();
  await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
  manager.pauseUploads();
  pending.reject(new Error("Late failure"));
  await vi.waitFor(async () =>
    expect(await db.fileUploadOperations.get(id)).toMatchObject({
      retryCount: 1,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect(put).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});
