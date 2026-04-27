import {
  highlightKeys,
  HIGHLIGHTS_QUERY_GC_TIME_MS,
} from "@/hooks/use-highlights-query";
import { bookKeys } from "@/hooks/use-book-loader";
import {
  getBook,
  getBookHighlights,
  getCurrentDeviceReadingCheckpoint,
  type Book,
} from "@/lib/db";
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
  buildReaderChapterArtifact,
  loadReaderBodyCache,
  READER_CHAPTER_ARTIFACTS_GC_MS,
  type ReaderBodyCacheData,
} from "./cache";
import {
  readerBodyCacheKeys,
  readerChapterArtifactKeys,
  readerCheckpointKeys,
  type ReaderCheckpointData,
} from "./hooks";

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
}

export async function prefetchReaderBook(
  queryClient: QueryClient,
  book: Book,
  options: PrefetchReaderBookOptions = {},
): Promise<void> {
  const includeArtifacts = options.includeArtifacts ?? true;
  const chapterEntries = buildChapterEntries(book);

  if (chapterEntries.length === 0) return;

  const bodyCacheKey = readerBodyCacheKeys.book(book.id, book.fileHash);
  const checkpointKey = readerCheckpointKeys.currentDevice(book.id);
  const highlightsKey = highlightKeys.book(book.id);

  queryClient.setQueryData(bookKeys.detail(book.id), book);

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: bookKeys.detail(book.id),
      queryFn: async () => {
        const latestBook = await getBook(book.id);
        if (!latestBook) throw new Error("Book not found");
        return latestBook;
      },
      staleTime: BOOK_DETAIL_STALE_TIME_MS,
      gcTime: BOOK_DETAIL_GC_TIME_MS,
    }),
    queryClient.prefetchQuery({
      queryKey: bodyCacheKey,
      queryFn: () =>
        loadReaderBodyCache({
          bookId: book.id,
          fileHash: book.fileHash,
          chapterEntries,
        }),
      staleTime: Infinity,
      gcTime: Infinity,
    }),
    queryClient.prefetchQuery({
      queryKey: checkpointKey,
      queryFn: async () => ({
        checkpoint: await getCurrentDeviceReadingCheckpoint(book.id),
      }),
      staleTime: Infinity,
      gcTime: Infinity,
    }),
    queryClient.prefetchQuery({
      queryKey: highlightsKey,
      queryFn: () => getBookHighlights(book.id),
      staleTime: Infinity,
      gcTime: HIGHLIGHTS_QUERY_GC_TIME_MS,
    }),
  ]);

  if (!includeArtifacts) return;

  const bodyCache =
    queryClient.getQueryData<ReaderBodyCacheData>(bodyCacheKey);
  if (!bodyCache) return;

  const checkpointData =
    queryClient.getQueryData<ReaderCheckpointData>(checkpointKey);
  const highlights =
    queryClient.getQueryData<Highlight[]>(highlightsKey) ?? [];
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

    await queryClient.prefetchQuery({
      queryKey: readerChapterArtifactKeys.chapter(
        book.id,
        book.fileHash,
        chapterIndex,
        chapter.spineItemId,
        highlightSignature,
      ),
      queryFn: () =>
        buildReaderChapterArtifact({
          baseContent,
          highlights: chapterHighlights,
        }),
      staleTime: Infinity,
      gcTime: READER_CHAPTER_ARTIFACTS_GC_MS,
    });
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
