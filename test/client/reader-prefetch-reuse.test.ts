import * as cache from "@/features/reader/data/reader-cache/cache";
import { prefetchReaderBook } from "@/features/reader/data/reader-cache/prefetch";
import type { ReaderDecoratedChapterArtifact } from "@/features/reader/data/chapter-content-pipeline";
import { useReaderChapterContent } from "@/features/reader/hooks/use-reader-chapter-content";
import { db, replaceBookMaterialization, type Book } from "@/lib/db";
import { parseFileId } from "@/lib/files/file-id";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { Blob as NodeBlob } from "node:buffer";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const book: Book = {
  id: "prefetched-book",
  sourceFileId: parseFileId("xxh64:1111111111111111"),
  title: "Prefetched book",
  author: "Test author",
  fileSize: 100,
  dateAdded: 1,
  cover: null,
  metadata: {},
  manifest: [
    {
      id: "chapter-1",
      href: "chapter.xhtml",
      mediaType: "application/xhtml+xml",
    },
  ],
  spine: [{ idref: "chapter-1" }],
  toc: [],
};
let client: QueryClient;

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await db.open();
  await replaceBookMaterialization({
    book,
    bookFiles: [
      {
        id: `${book.id}:chapter.xhtml`,
        bookId: book.id,
        path: "chapter.xhtml",
        mediaType: "application/xhtml+xml",
        content: new NodeBlob(
          [
            "<html><head><style>p { font-size: 24px; }</style></head><body><p>Hello reader.</p></body></html>",
          ],
          { type: "application/xhtml+xml" },
        ) as unknown as Blob,
      },
    ],
    recipeVersion: 1,
    writeBook: true,
  });
});

afterEach(async () => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  await db.delete();
});

it.each([
  { publisherBookStylingEnabled: false, matchPublisherBodyTextSize: false },
  { publisherBookStylingEnabled: true, matchPublisherBodyTextSize: false },
  { publisherBookStylingEnabled: true, matchPublisherBodyTextSize: true },
])(
  "reuses prefetched bodies and artifacts when the Reader opens with %o",
  async (settings) => {
    const loadBody = vi.spyOn(cache, "loadReaderBodyCache");
    const buildArtifact = vi.spyOn(cache, "buildReaderChapterArtifact");
    await prefetchReaderBook(client, book, settings);
    expect(loadBody).toHaveBeenCalledTimes(1);
    expect(buildArtifact).toHaveBeenCalledTimes(1);
    const artifacts = client.getQueriesData<ReaderDecoratedChapterArtifact>({
      queryKey: ["readerChapterArtifact"],
    });
    expect(artifacts).toHaveLength(1);
    const prefetchedArtifact = artifacts[0]![1]!;

    const { result } = renderHook(
      () => useReaderChapterContent({ bookId: book.id, book, ...settings }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client }, children),
      },
    );
    await waitFor(() =>
      expect(result.current.getChapterBlocks(0)).toBe(
        prefetchedArtifact.blocks,
      ),
    );
    expect(result.current.getChapterCanonicalText(0)?.fullText).toBe(
      "Hello reader.",
    );
    expect(loadBody).toHaveBeenCalledTimes(1);
    expect(buildArtifact).toHaveBeenCalledTimes(1);
  },
);
