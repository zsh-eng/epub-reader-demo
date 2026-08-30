/**
 * Temporary adapter for application code that still identifies files by a raw
 * digest and domain type. Step 3 removes this facade after Book uses FileId.
 */

import { computeFileId, fileIdFromContentHash } from "@/lib/files/file-id";
import { files } from "@/lib/files/files-manager";
import type {
  FileFetchResult,
  FileGetOptions,
  FileType,
  Files,
  Priority,
} from "@/lib/files/types";

export class FileManager {
  private readonly genericFiles: Files;

  constructor(genericFiles: Files = files) {
    this.genericFiles = genericFiles;
  }

  async getFile(
    contentHash: string,
    fileType: FileType,
    options: FileGetOptions = {},
  ): Promise<FileFetchResult> {
    const id = fileIdFromContentHash(contentHash);
    const fromCache = await this.genericFiles.hasLocal(id);

    if (!fromCache && options.localOnly) {
      throw new Error(`File not found locally: ${fileType}:${contentHash}`);
    }

    const blob = await this.genericFiles.get(id);
    return {
      blob,
      mediaType: blob.type || "application/octet-stream",
      fromCache,
    };
  }

  async hasLocal(contentHash: string, _fileType: FileType): Promise<boolean> {
    return this.genericFiles.hasLocal(fileIdFromContentHash(contentHash));
  }

  async storeFile(
    contentHash: string,
    _fileType: FileType,
    blob: Blob,
    mediaType: string,
  ): Promise<void> {
    await this.requireExpectedId(contentHash, blob);
    await this.genericFiles.put(blob, { mediaType });
  }

  async getFileUrl(
    contentHash: string,
    fileType: FileType,
    options: FileGetOptions = {},
  ): Promise<string> {
    const result = await this.getFile(contentHash, fileType, options);
    return URL.createObjectURL(result.blob);
  }

  async queueUpload(
    contentHash: string,
    fileType: FileType,
    blob: Blob,
    _options?: { priority?: Priority },
  ): Promise<string> {
    await this.requireExpectedId(contentHash, blob);
    const mediaType =
      blob.type ||
      (fileType === "epub"
        ? "application/epub+zip"
        : "application/octet-stream");
    return this.genericFiles.put(blob, { mediaType });
  }

  async queueDownload(
    contentHash: string,
    _fileType: FileType,
    _options?: { priority?: Priority },
  ): Promise<string> {
    const id = fileIdFromContentHash(contentHash);
    await this.genericFiles.ensureLocal(id);
    return id;
  }

  private async requireExpectedId(
    contentHash: string,
    blob: Blob,
  ): Promise<void> {
    const expectedId = fileIdFromContentHash(contentHash);
    const actualId = await computeFileId(blob);
    if (actualId !== expectedId) {
      throw new Error(
        `File content does not match its expected ID: ${expectedId}`,
      );
    }
  }
}

export const fileManager = new FileManager();
