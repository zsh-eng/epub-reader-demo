import { processEpubToBookFiles } from "@/lib/epub-processing";
import { db, hasBookFiles } from "@/lib/db";
import { files, type FileId } from "@/lib/files";
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
  book: (bookId: string, sourceFileId: FileId) =>
    ["epubPreparation", bookId, sourceFileId] as const,
};

async function ensureBookProcessed(
  bookId: string,
  sourceFileId: FileId,
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

    console.log("[useEpubProcessor] Fetching EPUB:", sourceFileId);

    const epubReadSpan = startReaderTraceSpan("epub-blob-read", "storage");
    const blob = await files.get(sourceFileId);
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

function getEpubPreparationQueryOptions(bookId: string, sourceFileId: FileId) {
  return queryOptions({
    queryKey: epubPreparationKeys.book(bookId, sourceFileId),
    queryFn: () => ensureBookProcessed(bookId, sourceFileId),
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
  sourceFileId: FileId,
): void {
  queryClient.setQueryData(
    epubPreparationKeys.book(bookId, sourceFileId),
    true,
  );
}

/** Ensures Library prefetches also warm the per-device extraction result. */
export async function ensureEpubPreparationReady(
  queryClient: QueryClient,
  bookId: string,
  sourceFileId: FileId,
): Promise<void> {
  await queryClient.ensureQueryData(
    getEpubPreparationQueryOptions(bookId, sourceFileId),
  );
}

/**
 * Hook to ensure EPUB is processed and bookFiles exist locally.
 *
 * This hook:
 * 1. Checks if bookFiles exist for the book
 * 2. If not, fetches the source EPUB through the files API
 * 3. Processes the EPUB to extract bookFiles
 * 4. Stores bookFiles in IndexedDB
 *
 * @param bookId - The book's unique identifier
 * @param sourceFileId - The source EPUB file reference
 * @returns Processing state and ready status
 */
export function useEpubProcessor(
  bookId: string | undefined,
  sourceFileId: FileId | undefined,
): UseEpubProcessorReturn {
  const query = useQuery({
    ...getEpubPreparationQueryOptions(
      bookId ?? "",
      sourceFileId ?? ("" as FileId),
    ),
    enabled: !!bookId && !!sourceFileId,
  });

  return {
    isProcessing: query.isFetching,
    isReady: query.data === true,
    error: query.error instanceof Error ? query.error : null,
  };
}
