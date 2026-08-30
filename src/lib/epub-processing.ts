/** Extract an EPUB blob into local-only BookFile rows. */

import type { BookFile } from "@/lib/db";
import type { FileId } from "@/lib/files";

export async function extractEpubFiles(
  epubBlob: Blob,
): Promise<Record<string, Uint8Array>> {
  const { unzip } = await import("fflate");
  const epubBytes = new Uint8Array(await epubBlob.arrayBuffer());

  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(epubBytes, (error, files) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(files);
    });
  });
}

export function createBookFilesFromExtracted(
  extractedFiles: Record<string, Uint8Array>,
  bookId: string,
): BookFile[] {
  return Object.entries(extractedFiles).map(([relativePath, content]) => {
    const mediaType = getMediaTypeFromPath(relativePath);
    return {
      id: crypto.randomUUID(),
      bookId,
      path: relativePath,
      content: new Blob([new Uint8Array(content)], { type: mediaType }),
      mediaType,
    };
  });
}

export function createEpubFile(blob: Blob, sourceFileId: FileId): File {
  return new File([blob], `${sourceFileId}.epub`, {
    type: "application/epub+zip",
  });
}

export async function processEpubToBookFiles(
  epubBlob: Blob,
  bookId: string,
): Promise<BookFile[]> {
  const extractedFiles = await extractEpubFiles(epubBlob);
  return createBookFilesFromExtracted(extractedFiles, bookId);
}

function getMediaTypeFromPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  const mediaTypes: Record<string, string> = {
    xhtml: "application/xhtml+xml",
    html: "application/xhtml+xml",
    xml: "application/xml",
    css: "text/css",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
    ncx: "application/x-dtbncx+xml",
    opf: "application/oebps-package+xml",
  };

  return mediaTypes[extension ?? ""] ?? "application/octet-stream";
}
