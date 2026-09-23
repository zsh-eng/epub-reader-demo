import {
  highlightKeys,
  HIGHLIGHTS_QUERY_GC_TIME_MS,
} from "@/hooks/use-highlights-query";
import { bookKeys } from "@/hooks/use-book-loader";
import { ensureEpubPreparationReady } from "@/hooks/use-epub-processor";
import { getBook, getBookHighlights, type Book } from "@/lib/db";
import type { Highlight } from "@/types/highlight";
import type { QueryClient } from "@tanstack/react-query";
import {
  buildChapterEntries,
  buildReaderChapterLoadOrder,
  resolveInitialReaderLocation,
} from "../chapter-content-pipeline";
import {
  buildHighlightSignature,
  buildHighlightsBySpineItemId,
} from "../../highlight-virtualization";
import {
  readerBodyCacheQueryOptions,
  readerChapterArtifactQueryOptions,
  readerCheckpointQueryOptions,
} from "./queries";

const BOOK_DETAIL_STALE_TIME_MS = 10 * 60 * 1000;
const BOOK_DETAIL_GC_TIME_MS = 30 * 60 * 1000;

interface PrefetchReaderBookOptions {
  /**
   * Build the decorated chapter artifacts after the cheaper body/checkpoint/
   * highlight queries are warm. This is intentionally opt-in for bulk prefetches
   * because parsing every chapter of several books can be CPU-heavy.
   */
  includeArtifacts?: boolean;
  artifactLimit?: number;
  publisherBookStylingEnabled?: boolean;
  matchPublisherBodyTextSize?: boolean;
}

export async function prefetchReaderBook(
  queryClient: QueryClient,
  book: Book,
  options: PrefetchReaderBookOptions = {},
): Promise<void> {
  const includeArtifacts = options.includeArtifacts ?? true;
  const publisherBookStylingEnabled =
    options.publisherBookStylingEnabled ?? false;
  const matchPublisherBodyTextSize =
    options.matchPublisherBodyTextSize ?? false;
  const chapterEntries = buildChapterEntries(book);

  if (chapterEntries.length === 0) return;

  let preparedBook: Book;
  try {
    preparedBook = await ensureEpubPreparationReady(queryClient, book);
  } catch {
    // Hover prefetch is optional. The Reader query owns errors and reconnect recovery.
    return;
  }

  const bodyQuery = readerBodyCacheQueryOptions({
    bookId: book.id,
    sourceFileId: book.sourceFileId,
    chapterEntries,
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
  });
  const checkpointQuery = readerCheckpointQueryOptions(book.id);
  const highlightsKey = highlightKeys.book(book.id);

  queryClient.setQueryData(bookKeys.detail(book.id), preparedBook);

  await Promise.all([
    queryClient.prefetchQuery({
      networkMode: "always", // Prefetch reads local data, not the server.
      queryKey: bookKeys.detail(book.id),
      queryFn: async () => {
        const latestBook = await getBook(book.id);
        if (!latestBook) throw new Error("Book not found");
        return latestBook;
      },
      staleTime: BOOK_DETAIL_STALE_TIME_MS,
      gcTime: BOOK_DETAIL_GC_TIME_MS,
    }),
    queryClient.prefetchQuery(bodyQuery),
    queryClient.prefetchQuery(checkpointQuery),
    queryClient.prefetchQuery({
      networkMode: "always", // Prefetch reads local data, not the server.
      queryKey: highlightsKey,
      queryFn: () => getBookHighlights(book.id),
      staleTime: Infinity,
      gcTime: HIGHLIGHTS_QUERY_GC_TIME_MS,
    }),
  ]);

  if (!includeArtifacts) return;

  const bodyCache = queryClient.getQueryData(bodyQuery.queryKey);
  if (!bodyCache) return;

  const checkpointData = queryClient.getQueryData(checkpointQuery.queryKey);
  const highlights = queryClient.getQueryData<Highlight[]>(highlightsKey) ?? [];
  const initialLocation = resolveInitialReaderLocation(
    checkpointData?.checkpoint,
    chapterEntries.length,
  );
  const highlightsBySpineItemId = buildHighlightsBySpineItemId(highlights);
  const chapterLoadOrder = buildReaderChapterLoadOrder(
    chapterEntries.length,
    initialLocation.chapterIndex,
  );
  const limitedChapterLoadOrder =
    options.artifactLimit === undefined
      ? chapterLoadOrder
      : chapterLoadOrder.slice(0, options.artifactLimit);

  for (const chapterIndex of limitedChapterLoadOrder) {
    const chapter = chapterEntries[chapterIndex]!;
    const baseContent = bodyCache.baseContentByChapter.get(chapterIndex)!;
    const chapterHighlights =
      highlightsBySpineItemId.get(chapter.spineItemId) ?? [];
    const highlightSignature = buildHighlightSignature(chapterHighlights);

    await queryClient.prefetchQuery(
      readerChapterArtifactQueryOptions({
        bookId: book.id,
        sourceFileId: book.sourceFileId,
        baseContent,
        highlights: chapterHighlights,
        highlightSignature,
        publisherBookStylingEnabled,
        matchPublisherBodyTextSize,
      }),
    );
  }
}

export async function prefetchReaderBooks(
  queryClient: QueryClient,
  books: readonly Book[],
  options: PrefetchReaderBookOptions = {},
): Promise<void> {
  await Promise.all(
    books.map((book) => prefetchReaderBook(queryClient, book, options)),
  );
}
