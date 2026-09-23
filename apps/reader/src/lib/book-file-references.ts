import { fileIdFromContentHash, parseFileId } from "@/lib/files/file-id";
import type { FileId } from "@/lib/files/types";

/** A synchronized cover reference. Derived placeholder data can be absent. */
export interface BookCoverRef {
  fileId: FileId;
  blurHash: string | null;
}

export interface BookFileReferences {
  sourceFileId: FileId;
  cover: BookCoverRef | null;
}

interface LegacyBookFileReferences {
  fileHash: string;
  coverContentHash?: string;
  isDownloaded?: number;
}

export function getBookCoverFileId(
  book: Pick<BookFileReferences, "cover">,
): FileId | undefined {
  return book.cover?.fileId;
}

/** Normalize both local v3 rows and older synchronized Book values. */
export function normalizeBookFileReferences(
  value: Record<string, unknown>,
): Record<string, unknown> & BookFileReferences {
  if (typeof value.sourceFileId === "string") {
    const {
      fileHash: _fileHash,
      coverContentHash: _coverContentHash,
      isDownloaded: _isDownloaded,
      ...book
    } = value;
    return {
      ...book,
      sourceFileId: parseFileId(value.sourceFileId),
      cover: parseBookCoverRef(value.cover),
    };
  }

  const legacy = value as unknown as LegacyBookFileReferences;
  if (typeof legacy.fileHash !== "string") {
    throw new Error("Book is missing its source file reference");
  }

  const {
    fileHash,
    coverContentHash,
    isDownloaded: _isDownloaded,
    ...book
  } = legacy;
  return {
    ...book,
    sourceFileId: fileIdFromContentHash(fileHash),
    cover:
      typeof coverContentHash === "string"
        ? {
            fileId: fileIdFromContentHash(coverContentHash),
            blurHash: null,
          }
        : null,
  } as Record<string, unknown> & BookFileReferences;
}

/** Book sync values must contain references, never inline file bytes. */
export function assertBookSyncValue(value: Record<string, unknown>): void {
  inspectBookValue(value, "book");
}

function parseBookCoverRef(value: unknown): BookCoverRef | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Book has an invalid cover reference");
  }

  const cover = value as Record<string, unknown>;
  if (
    typeof cover.fileId === "string" &&
    (typeof cover.blurHash === "string" || cover.blurHash === null)
  ) {
    return {
      fileId: parseFileId(cover.fileId),
      blurHash: cover.blurHash,
    };
  }

  throw new Error("Book has an invalid cover reference");
}

function inspectBookValue(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (value.startsWith("data:") || looksLikeBase64(value)) {
      throw new Error(`Book sync value contains inline file data at ${path}`);
    }
    return;
  }

  if (value instanceof Blob || value instanceof ArrayBuffer) {
    throw new Error(`Book sync value contains file bytes at ${path}`);
  }
  if (ArrayBuffer.isView(value)) {
    throw new Error(`Book sync value contains file bytes at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectBookValue(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value)) {
    if (/base64|dataurl/i.test(key)) {
      throw new Error(`Book sync value contains inline file data at ${path}.${key}`);
    }
    inspectBookValue(entry, `${path}.${key}`);
  }
}

function looksLikeBase64(value: string): boolean {
  return (
    value.length >= 128 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}
