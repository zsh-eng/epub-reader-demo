import { hashFileData } from "@/lib/file-hash";
import type { FileId } from "@/lib/files/types";

const FILE_ID_PATTERN = /^xxh64:[0-9a-f]{16}$/;
const CONTENT_HASH_PATTERN = /^[0-9a-f]{16}$/;

export function parseFileId(value: string): FileId {
  if (!FILE_ID_PATTERN.test(value)) {
    throw new Error(`Invalid file ID: ${value}`);
  }

  return value as FileId;
}

/** Migration bridge for legacy rows that stored a raw xxHash digest. */
export function fileIdFromContentHash(contentHash: string): FileId {
  if (!CONTENT_HASH_PATTERN.test(contentHash)) {
    throw new Error(`Invalid xxHash64 digest: ${contentHash}`);
  }

  return parseFileId(`xxh64:${contentHash}`);
}

export async function computeFileId(blob: Blob): Promise<FileId> {
  const content = new Uint8Array(await blob.arrayBuffer());
  return parseFileId(`xxh64:${await hashFileData(content)}`);
}
