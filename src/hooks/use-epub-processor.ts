import { fileManager } from "@/lib/files/file-manager";
import { processEpubToBookFiles } from "@/lib/sync/epub-processing";
import { db, hasBookFiles } from "@/lib/db";
import {
  endReaderTraceSpan,
  startReaderTraceSpan,
} from "@/lib/reader-performance-trace";
import {
  queryOptions,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";

export interface UseEpubProcessorReturn {
  /** Whether the EPUB is currently being processed */
  isProcessing: boolean;
  /** Whether the book files are ready to use */
  isReady: boolean;
  /** Any error that occurred during processing */
  error: Error | null;
}

export const epubPreparationKeys = {
  book: (bookId: string, fileHash: string) =>
    ["epubPreparation", bookId, fileHash] as const,
};

async function ensureBookProcessed(
  bookId: string,
  fileHash: string,
): Promise<true> {
  const preparationSpan = startReaderTraceSpan(
    "epub-preparation",
    "processing",
  );

  try {
    const lookupSpan = startReaderTraceSpan(
      "extracted-book-files-check",
      "storage",
    );
    const hasExistingFiles = await hasBookFiles(bookId);
    endReaderTraceSpan(lookupSpan, { cacheHit: hasExistingFiles });

    if (hasExistingFiles) {
      endReaderTraceSpan(preparationSpan, { loadKind: "cache-hit" });
      return true;
    }

    console.log("[useEpubProcessor] Fetching EPUB:", fileHash);

    const epubReadSpan = startReaderTraceSpan("epub-blob-read", "storage");
    const { blob } = await fileManager.getFile(fileHash, "epub");
    endReaderTraceSpan(epubReadSpan, { sizeBytes: blob.size });

    console.log("[useEpubProcessor] Processing EPUB...");

    const extractionSpan = startReaderTraceSpan(
      "epub-extraction",
      "processing",
    );
    const bookFiles = await processEpubToBookFiles(blob, bookId);
    endReaderTraceSpan(extractionSpan, { fileCount: bookFiles.length });

    console.log(
      "[useEpubProcessor] Storing",
      bookFiles.length,
      "book files...",
    );

    const writeSpan = startReaderTraceSpan(
      "extracted-book-files-write",
      "storage",
    );
    await db.bookFiles.bulkAdd(bookFiles);
    await db.books.update(bookId, { isDownloaded: 1 });
    endReaderTraceSpan(writeSpan, { fileCount: bookFiles.length });
    endReaderTraceSpan(preparationSpan, {
      loadKind: "extracted",
      fileCount: bookFiles.length,
    });

    console.log("[useEpubProcessor] Book ready!");
    return true;
  } catch (error) {
    endReaderTraceSpan(
      preparationSpan,
      { error: error instanceof Error ? error.message : String(error) },
      "error",
    );
    throw error;
  }
}

function getEpubPreparationQueryOptions(bookId: string, fileHash: string) {
  return queryOptions({
    queryKey: epubPreparationKeys.book(bookId, fileHash),
    queryFn: () => ensureBookProcessed(bookId, fileHash),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}

/**
 * Records the per-device extraction completed by the import transaction. The
 * Reader can then trust local readiness without another IndexedDB round trip.
 */
export function markEpubPreparationReady(
  queryClient: QueryClient,
  bookId: string,
  fileHash: string,
): void {
  queryClient.setQueryData(epubPreparationKeys.book(bookId, fileHash), true);
}

/** Ensures Library prefetches also warm the per-device extraction result. */
export async function ensureEpubPreparationReady(
  queryClient: QueryClient,
  bookId: string,
  fileHash: string,
): Promise<void> {
  await queryClient.ensureQueryData(
    getEpubPreparationQueryOptions(bookId, fileHash),
  );
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
  const query = useQuery({
    ...getEpubPreparationQueryOptions(bookId ?? "", fileHash ?? ""),
    enabled: !!bookId && !!fileHash,
  });

  return {
    isProcessing: query.isFetching,
    isReady: query.data === true,
    error: query.error instanceof Error ? query.error : null,
  };
}
