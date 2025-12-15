import { getBookFile } from "@/lib/db";
import {
  cleanupResourceUrls,
  processEmbeddedResources,
} from "@/lib/epub-resource-utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/**
 * Data returned from fetching chapter content
 */
export interface ChapterContentData {
  /** The processed HTML content of the chapter */
  content: string;
  /** The manifest item href that was loaded */
  manifestItemHref: string;
}

export interface UseChapterContentReturn {
  /** The processed HTML content of the chapter */
  chapterContent: string;
  /** Whether the chapter is currently loading */
  isLoading: boolean;
  /** Whether the chapter is being fetched (includes background refetches) */
  isFetching: boolean;
  /** Any error that occurred while loading */
  error: Error | null;
}

/**
 * Query key factory for chapter content queries
 */
export const chapterContentKeys = {
  all: ["chapter-content"] as const,
  book: (bookId: string) => [...chapterContentKeys.all, bookId] as const,
  chapter: (bookId: string, manifestItemHref: string) =>
    [...chapterContentKeys.book(bookId), manifestItemHref] as const,
};

/**
 * Fetches and processes chapter content from the database
 */
async function fetchChapterContent(
  bookId: string,
  manifestItemHref: string,
  resourceUrlMap: Map<string, string>,
): Promise<ChapterContentData> {
  // Load the file content from the database
  const bookFile = await getBookFile(bookId, manifestItemHref);

  if (!bookFile) {
    throw new Error(`Chapter content not found: ${manifestItemHref}`);
  }

  // Convert blob to text
  const text = await bookFile.content.text();

  // Process embedded resources (images, stylesheets, fonts, etc.)
  const { document: doc } = await processEmbeddedResources({
    content: text,
    mediaType: bookFile.mediaType,
    basePath: manifestItemHref,
    loadResource: async (path: string) => {
      const resourceFile = await getBookFile(bookId, path);
      return resourceFile?.content || null;
    },
    resourceUrlMap,
  });

  return {
    content: doc.body.innerHTML,
    manifestItemHref,
  };
}

/**
 * Hook for loading chapter content using React Query.
 *
 * This hook handles:
 * - Fetching chapter content from the database
 * - Processing embedded resources (images, stylesheets, fonts)
 * - Caching chapter content for instant navigation
 * - Race condition prevention via React Query's built-in mechanisms
 * - Resource URL cleanup when chapters are evicted from cache
 *
 * @param bookId - The book's unique identifier
 * @param manifestItemHref - The href of the manifest item to load (from spine)
 * @returns Chapter content, loading state, and error information
 */
export function useChapterContent(
  bookId: string | undefined,
  manifestItemHref: string | null,
): UseChapterContentReturn {
  const queryClient = useQueryClient();

  // Store resource URLs for cleanup
  // Using a ref to persist across renders without causing re-renders
  const resourceUrlMapRef = useRef<Map<string, string>>(new Map());

  // Clean up previous resource URLs when manifestItemHref changes
  useEffect(() => {
    const currentMap = resourceUrlMapRef.current;

    return () => {
      // Only cleanup if we're switching chapters
      // The new chapter will create its own URLs
      cleanupResourceUrls(currentMap);
      resourceUrlMapRef.current = new Map();
    };
  }, [manifestItemHref]);

  // Set up cache eviction listener for resource URL cleanup
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type !== "removed" ||
        event.query.queryKey[0] !== "chapter-content"
      ) {
        return;
      }

      // When a chapter query is removed from cache, clean up its resource URLs
      // Note: This is a defensive cleanup - the main cleanup happens in the effect above
      const currentMap = resourceUrlMapRef.current;
      cleanupResourceUrls(currentMap);
      resourceUrlMapRef.current = new Map();
    });

    return unsubscribe;
  }, [queryClient]);

  const query = useQuery({
    queryKey: chapterContentKeys.chapter(bookId ?? "", manifestItemHref ?? ""),
    queryFn: () =>
      fetchChapterContent(
        bookId!,
        manifestItemHref!,
        resourceUrlMapRef.current,
      ),
    enabled: !!bookId && !!manifestItemHref,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes after becoming unused
    refetchOnWindowFocus: false, // Don't refetch when window regains focus
    refetchOnMount: false, // Don't refetch when component mounts if data exists
    retry: 1, // Only retry once on failure
  });

  // Reset scroll position when chapter content changes successfully
  const loadedManifestHref = query.data?.manifestItemHref;
  useEffect(() => {
    if (!loadedManifestHref) return;
    window.scrollTo({
      top: 0,
      behavior: "instant",
    });
  }, [loadedManifestHref]);

  return {
    chapterContent: query.data?.content ?? "",
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}

/**
 * Utility hook to get the manifest item href from a spine index
 * This can be used in conjunction with useChapterContent
 */
export function getManifestItemHref(
  book: {
    manifest: { id: string; href: string }[];
    spine: { idref: string }[];
  } | null,
  chapterIndex: number,
): string | null {
  if (!book) return null;

  const spineItem = book.spine[chapterIndex];
  if (!spineItem) return null;

  const manifestItem = book.manifest.find(
    (item) => item.id === spineItem.idref,
  );

  return manifestItem?.href ?? null;
}
