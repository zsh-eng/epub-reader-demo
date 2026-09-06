import { bookKeys } from "@/hooks/use-book-loader";
import {
  prepareBook,
  type BookPreparationResult,
} from "@/lib/book-preparation";
import type { Book } from "@/lib/db";
import {
  queryOptions,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

export interface UseEpubProcessorReturn {
  /** Whether the EPUB is currently being processed */
  isProcessing: boolean;
  /** Whether the book files are ready to use */
  isReady: boolean;
  /** Any error that occurred during processing */
  error: Error | null;
}

export const epubPreparationKeys = {
  book: (book: Pick<Book, "id" | "sourceFileId">) =>
    ["epubPreparation", book.id, book.sourceFileId] as const,
  disabled: ["epubPreparation", "disabled"] as const,
};

function getEpubPreparationQueryOptions(book: Book) {
  return queryOptions({
    networkMode: "offlineFirst", // Try local materialization before needing a download.
    queryKey: epubPreparationKeys.book(book),
    queryFn: () => prepareBook(book),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}

function updatePreparedBookQueries(
  queryClient: QueryClient,
  result: BookPreparationResult,
): void {
  if (!result.bookChanged) return;

  queryClient.setQueryData(bookKeys.detail(result.book.id), result.book);
  void queryClient.invalidateQueries({ queryKey: bookKeys.list() });
}

/** Record the materialization completed by the import transaction. */
export function markEpubPreparationReady(
  queryClient: QueryClient,
  book: Book,
): void {
  queryClient.setQueryData(epubPreparationKeys.book(book), {
    book,
    bookChanged: false,
    materialized: false,
  } satisfies BookPreparationResult);
}

/** Ensure Library prefetches use the same deterministic preparation path. */
export async function ensureEpubPreparationReady(
  queryClient: QueryClient,
  book: Book,
): Promise<Book> {
  const result = await queryClient.ensureQueryData(
    getEpubPreparationQueryOptions(book),
  );
  updatePreparedBookQueries(queryClient, result);
  return result.book;
}

/** Ensure the source EPUB has a complete local materialization. */
export function useEpubProcessor(book: Book | null): UseEpubProcessorReturn {
  const queryClient = useQueryClient();
  const query = useQuery({
    networkMode: "offlineFirst", // Failed local preparation retries on reconnect.
    queryKey: book
      ? epubPreparationKeys.book(book)
      : epubPreparationKeys.disabled,
    queryFn: () => prepareBook(book!),
    enabled: book !== null,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (query.data) updatePreparedBookQueries(queryClient, query.data);
  }, [query.data, queryClient]);

  return {
    isProcessing: query.isFetching,
    isReady: query.data !== undefined,
    error: query.error instanceof Error ? query.error : null,
  };
}
