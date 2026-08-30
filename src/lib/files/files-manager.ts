import { db } from "@/lib/db";
import { computeFileId } from "@/lib/files/file-id";
import {
  FetchFileRemoteApi,
  FileRemoteRequestError,
  type FileRemoteApi,
} from "@/lib/files/file-remote-api";
import type {
  FileId,
  FileMetadata,
  Files,
  FileUploadOperation,
  LocalFile,
  RemoteFile,
} from "@/lib/files/types";

const DEFAULT_MEDIA_TYPE = "application/octet-stream";

/**
 * Local-first file facade and durable upload worker.
 *
 * `put()` commits the Blob and upload intent in one transaction. Downloads are
 * foreground operations shared by FileId. Uploads run only while the app has
 * enabled them for an authenticated, online session.
 */
export class FilesManager implements Files {
  private readonly remote: FileRemoteApi;
  private readonly downloads = new Map<FileId, Promise<Blob>>();
  private uploadsEnabled = false;
  private uploadLoop: Promise<void> | null = null;
  private uploadWakeRequested = false;

  constructor(remote: FileRemoteApi) {
    this.remote = remote;
  }

  async put(blob: Blob, metadata: FileMetadata = {}): Promise<FileId> {
    const id = await computeFileId(blob);
    const mediaType = metadata.mediaType || blob.type || DEFAULT_MEDIA_TYPE;
    const storedBlob =
      blob.type === mediaType ? blob : blob.slice(0, blob.size, mediaType);

    await db.transaction(
      "rw",
      [db.files, db.fileUploadOperations],
      async () => {
        const existingFile = await db.files.get(id);
        if (existingFile?.remotePresent) return;

        if (!existingFile) {
          await db.files.add({
            id,
            blob: storedBlob,
            mediaType,
            size: storedBlob.size,
            storedAt: Date.now(),
            remotePresent: false,
          });
        }

        const existingOperation = await db.fileUploadOperations.get(id);
        if (existingOperation) return;

        await db.fileUploadOperations.add({
          id,
          createdAt: Date.now(),
          retryCount: 0,
          lastFailure: { kind: "none" },
        });
      },
    );

    this.startUploadLoop();
    return id;
  }

  async get(id: FileId): Promise<Blob> {
    const localFile = await db.files.get(id);
    if (localFile) return localFile.blob;

    const activeDownload = this.downloads.get(id);
    if (activeDownload) return activeDownload;

    const download = this.downloadAndStore(id);
    this.downloads.set(id, download);

    try {
      return await download;
    } finally {
      this.downloads.delete(id);
    }
  }

  async hasLocal(id: FileId): Promise<boolean> {
    return (await db.files.get(id)) !== undefined;
  }

  async ensureLocal(id: FileId): Promise<void> {
    await this.get(id);
  }

  async listLocal(): Promise<LocalFile[]> {
    return db.files.orderBy("storedAt").toArray();
  }

  async listRemote(): Promise<RemoteFile[]> {
    return this.remote.list();
  }

  async deleteRemote(id: FileId): Promise<void> {
    const resumeUploads = this.uploadsEnabled;
    this.pauseUploads();
    await this.uploadLoop;

    try {
      try {
        await this.remote.delete(id);
      } catch (error) {
        if (
          !(error instanceof FileRemoteRequestError) ||
          error.status !== 404
        ) {
          throw error;
        }
      }

      await db.transaction(
        "rw",
        [db.files, db.fileUploadOperations],
        async () => {
          const localFile = await db.files.get(id);
          if (localFile) {
            await db.files.update(id, { remotePresent: false });
          }
          await db.fileUploadOperations.delete(id);
        },
      );
    } finally {
      if (resumeUploads) this.resumeUploads();
    }
  }

  resumeUploads(): void {
    this.uploadsEnabled = true;
    this.startUploadLoop();
  }

  pauseUploads(): void {
    this.uploadsEnabled = false;
  }

  private async downloadAndStore(id: FileId): Promise<Blob> {
    const blob = await this.remote.get(id);
    const mediaType = blob.type || DEFAULT_MEDIA_TYPE;

    await db.transaction(
      "rw",
      [db.files, db.fileUploadOperations],
      async () => {
        await db.files.put({
          id,
          blob,
          mediaType,
          size: blob.size,
          storedAt: Date.now(),
          remotePresent: true,
        });
        await db.fileUploadOperations.delete(id);
      },
    );

    return blob;
  }

  private startUploadLoop(): void {
    if (!this.uploadsEnabled) return;
    if (this.uploadLoop) {
      this.uploadWakeRequested = true;
      return;
    }

    this.uploadWakeRequested = false;
    this.uploadLoop = this.processUploads().finally(() => {
      this.uploadLoop = null;
      if (this.uploadWakeRequested) this.startUploadLoop();
    });
  }

  private async processUploads(): Promise<void> {
    while (this.uploadsEnabled) {
      const operation = await db.fileUploadOperations
        .orderBy("createdAt")
        .first();
      if (!operation) return;

      const succeeded = await this.processUpload(operation);
      if (!succeeded) return;
    }
  }

  private async processUpload(
    operation: FileUploadOperation,
  ): Promise<boolean> {
    const localFile = await db.files.get(operation.id);
    if (!localFile) {
      await db.fileUploadOperations.delete(operation.id);
      return true;
    }

    try {
      await this.remote.put(operation.id, localFile.blob, localFile.mediaType);
      await db.transaction(
        "rw",
        [db.files, db.fileUploadOperations],
        async () => {
          await db.files.update(operation.id, { remotePresent: true });
          await db.fileUploadOperations.delete(operation.id);
        },
      );
      return true;
    } catch (error) {
      await db.fileUploadOperations.update(operation.id, {
        retryCount: operation.retryCount + 1,
        lastFailure: {
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
          failedAt: Date.now(),
        },
      });
      return false;
    }
  }
}

export const files = new FilesManager(new FetchFileRemoteApi());
