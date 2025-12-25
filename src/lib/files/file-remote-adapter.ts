/**
 * File Remote Adapter
 *
 * Provides an abstraction over the remote server API for file transfer operations.
 * This adapter is used by the transfer queue to upload and download files.
 */

import { honoClient } from "@/lib/api";
import type { FileType } from "@/lib/files/types";

/**
 * Remote adapter interface for file transfer operations
 */
export interface FileRemoteAdapter {
  /**
   * Upload a file to the server
   *
   * @param contentHash - Content hash of the file
   * @param fileType - Type of file (e.g., 'epub', 'cover')
   * @param blob - File blob to upload
   * @returns Promise that resolves when upload is complete
   * @throws Error if upload fails
   */
  uploadFile(
    contentHash: string,
    fileType: FileType,
    blob: Blob,
  ): Promise<void>;

  /**
   * Download a file from the server
   *
   * @param contentHash - Content hash of the file
   * @param fileType - Type of file (e.g., 'epub', 'cover')
   * @returns Promise with blob and media type
   * @throws Error if download fails or file not found
   */
  downloadFile(
    contentHash: string,
    fileType: FileType,
  ): Promise<{ blob: Blob; mediaType: string }>;
}

/**
 * Hono client implementation of FileRemoteAdapter
 */
export class HonoFileRemoteAdapter implements FileRemoteAdapter {
  async uploadFile(
    _contentHash: string,
    fileType: FileType,
    blob: Blob,
  ): Promise<void> {
    const formData = new FormData();
    formData.append("file", blob);
    formData.append("fileType", fileType);
    const url = `/api/files/upload`;
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Upload failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }
  }

  async downloadFile(
    contentHash: string,
    fileType: FileType,
  ): Promise<{ blob: Blob; mediaType: string }> {
    const response = await honoClient.api.files[":fileType"][
      ":contentHash"
    ].$get({
      param: { fileType, contentHash },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`File not found on server: ${fileType}:${contentHash}`);
      }
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Download failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const blob = await response.blob();
    const mediaType =
      response.headers.get("Content-Type") || "application/octet-stream";

    return { blob, mediaType };
  }
}

/**
 * Mock implementation of FileRemoteAdapter for testing
 */
export class MockFileRemoteAdapter implements FileRemoteAdapter {
  private uploadedFiles = new Map<string, { blob: Blob; mediaType: string }>();
  private shouldFailUpload = false;
  private shouldFailDownload = false;
  private uploadDelay = 0;
  private downloadDelay = 0;

  async uploadFile(
    contentHash: string,
    fileType: FileType,
    blob: Blob,
  ): Promise<void> {
    if (this.uploadDelay > 0) {
      await this.delay(this.uploadDelay);
    }

    if (this.shouldFailUpload) {
      throw new Error("Mock upload failed");
    }

    const key = this.createKey(fileType, contentHash);
    this.uploadedFiles.set(key, { blob, mediaType: blob.type });
  }

  async downloadFile(
    contentHash: string,
    fileType: FileType,
  ): Promise<{ blob: Blob; mediaType: string }> {
    if (this.downloadDelay > 0) {
      await this.delay(this.downloadDelay);
    }

    if (this.shouldFailDownload) {
      throw new Error("Mock download failed");
    }

    const key = this.createKey(fileType, contentHash);
    const file = this.uploadedFiles.get(key);

    if (!file) {
      throw new Error(`File not found on server: ${fileType}:${contentHash}`);
    }

    return file;
  }

  // Test utilities
  setUploadFailure(shouldFail: boolean): void {
    this.shouldFailUpload = shouldFail;
  }

  setDownloadFailure(shouldFail: boolean): void {
    this.shouldFailDownload = shouldFail;
  }

  setUploadDelay(ms: number): void {
    this.uploadDelay = ms;
  }

  setDownloadDelay(ms: number): void {
    this.downloadDelay = ms;
  }

  hasFile(fileType: FileType, contentHash: string): boolean {
    const key = this.createKey(fileType, contentHash);
    return this.uploadedFiles.has(key);
  }

  getUploadedFiles(): Array<{
    fileType: string;
    contentHash: string;
    blob: Blob;
    mediaType: string;
  }> {
    const files: Array<{
      fileType: string;
      contentHash: string;
      blob: Blob;
      mediaType: string;
    }> = [];

    for (const [key, file] of this.uploadedFiles.entries()) {
      const [fileType, contentHash] = key.split(":");
      files.push({ fileType, contentHash, ...file });
    }

    return files;
  }

  reset(): void {
    this.uploadedFiles.clear();
    this.shouldFailUpload = false;
    this.shouldFailDownload = false;
    this.uploadDelay = 0;
    this.downloadDelay = 0;
  }

  private createKey(fileType: FileType, contentHash: string): string {
    return `${fileType}:${contentHash}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a Hono file remote adapter
 *
 * @returns HonoFileRemoteAdapter instance
 */
export function createHonoFileRemoteAdapter(): HonoFileRemoteAdapter {
  return new HonoFileRemoteAdapter();
}

/**
 * Create a mock file remote adapter for testing
 *
 * @returns MockFileRemoteAdapter instance
 */
export function createMockFileRemoteAdapter(): MockFileRemoteAdapter {
  return new MockFileRemoteAdapter();
}
