import { fileManager } from "@/lib/files/file-manager";
import { processEpubToBookFiles } from "@/lib/sync/epub-processing";
import { db, hasBookFiles } from "@/lib/db";
import {
  endReaderTraceSpan,
  startReaderTraceSpan,
} from "@/lib/reader-performance-trace";
import { useState, useEffect } from "react";

export interface UseEpubProcessorReturn {
  /** Whether the EPUB is currently being processed */
  isProcessing: boolean;
  /** Whether the book files are ready to use */
  isReady: boolean;
  /** Any error that occurred during processing */
  error: Error | null;
}

/**
 * Hook to ensure EPUB is processed and bookFiles exist locally.
 *
 * This hook:
 * 1. Checks if bookFiles exist for the book
 * 2. If not, fetches the EPUB via fileManager
 * 3. Processes the EPUB to extract bookFiles
 * 4. Stores bookFiles in IndexedDB
 * 5. Marks the book as downloaded
 *
 * @param bookId - The book's unique identifier
 * @param fileHash - The content hash of the EPUB file
 * @returns Processing state and ready status
 */
export function useEpubProcessor(
  bookId: string | undefined,
  fileHash: string | undefined,
): UseEpubProcessorReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!bookId || !fileHash) {
      return;
    }

    let isCancelled = false;

    async function ensureBookProcessed() {
      const preparationSpan = startReaderTraceSpan(
        "epub-preparation",
        "processing",
      );
      try {
        // Check if bookFiles already exist
        const lookupSpan = startReaderTraceSpan(
          "extracted-book-files-check",
          "storage",
        );
        const hasExistingFiles = await hasBookFiles(bookId!);
        endReaderTraceSpan(lookupSpan, { cacheHit: hasExistingFiles });

        if (hasExistingFiles) {
          // Book is already processed
          if (!isCancelled) {
            setIsReady(true);
          }
          endReaderTraceSpan(preparationSpan, { loadKind: "cache-hit" });
          return;
        }

        // BookFiles don't exist - need to fetch and process EPUB
        if (!isCancelled) {
          setIsProcessing(true);
          setError(null);
        }

        console.log("[useEpubProcessor] Fetching EPUB:", fileHash);

        // Fetch EPUB from fileManager (checks local cache first, then network)
        const epubReadSpan = startReaderTraceSpan("epub-blob-read", "storage");
        const { blob } = await fileManager.getFile(fileHash!, "epub");
        endReaderTraceSpan(epubReadSpan, { sizeBytes: blob.size });

        console.log("[useEpubProcessor] Processing EPUB...");

        // Process EPUB to extract bookFiles
        const extractionSpan = startReaderTraceSpan(
          "epub-extraction",
          "processing",
        );
        const bookFiles = await processEpubToBookFiles(blob, bookId!);
        endReaderTraceSpan(extractionSpan, { fileCount: bookFiles.length });

        console.log(
          "[useEpubProcessor] Storing",
          bookFiles.length,
          "book files...",
        );

        // Store bookFiles in IndexedDB
        const writeSpan = startReaderTraceSpan(
          "extracted-book-files-write",
          "storage",
        );
        await db.bookFiles.bulkAdd(bookFiles);

        // Mark book as downloaded
        await db.books.update(bookId!, {
          isDownloaded: 1,
        });
        endReaderTraceSpan(writeSpan, { fileCount: bookFiles.length });

        console.log("[useEpubProcessor] Book ready!");

        if (!isCancelled) {
          setIsReady(true);
          setIsProcessing(false);
        }
        endReaderTraceSpan(preparationSpan, {
          loadKind: "extracted",
          fileCount: bookFiles.length,
        });
      } catch (err) {
        endReaderTraceSpan(
          preparationSpan,
          { error: err instanceof Error ? err.message : String(err) },
          "error",
        );
        console.error("[useEpubProcessor] Error processing EPUB:", err);
        if (!isCancelled) {
          setError(
            err instanceof Error ? err : new Error("Failed to process EPUB"),
          );
          setIsProcessing(false);
        }
      }
    }

    ensureBookProcessed();

    return () => {
      isCancelled = true;
    };
  }, [bookId, fileHash]);

  return {
    isProcessing,
    isReady,
    error,
  };
}
