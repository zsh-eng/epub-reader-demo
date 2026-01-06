/**
 * useBookSearch Hook
 *
 * Provides full-text search functionality for a book.
 * Handles text extraction, caching, and search with debouncing.
 */

import type { BookTextCache } from "@/lib/db";
import {
  type SearchOptions,
  type SearchResult,
  getOrExtractBookText,
  searchBook,
} from "@/lib/book-search";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface UseBookSearchReturn {
  /** Current search results */
  searchResults: SearchResult | null;
  /** True while extracting text from book */
  isExtracting: boolean;
  /** True during search operation */
  isSearching: boolean;
  /** Extraction progress (0-100) */
  extractionProgress: number;
  /** Whether text cache is ready for searching */
  isReady: boolean;
  /** Error if extraction failed */
  error: Error | null;
  /** Perform a search */
  search: (query: string, options?: SearchOptions) => void;
  /** Clear search results */
  clearSearch: () => void;
  /** Current search query */
  currentQuery: string;
}

/**
 * Hook for searching within a book's text content.
 *
 * @param bookId - The book to search in
 * @returns Search state and functions
 */
export function useBookSearch(bookId: string | undefined): UseBookSearchReturn {
  // Text cache state
  const [textCache, setTextCache] = useState<BookTextCache | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [currentQuery, setCurrentQuery] = useState("");
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({});

  // Load or extract text cache when bookId changes
  useEffect(() => {
    if (!bookId) {
      setTextCache(null);
      setSearchResults(null);
      setCurrentQuery("");
      return;
    }

    let cancelled = false;

    async function loadTextCache() {
      setIsExtracting(true);
      setExtractionProgress(0);
      setError(null);

      try {
        const cache = await getOrExtractBookText(bookId!, (progress) => {
          if (!cancelled) {
            setExtractionProgress(progress);
          }
        });

        if (!cancelled) {
          setTextCache(cache);
          setExtractionProgress(100);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setIsExtracting(false);
        }
      }
    }

    loadTextCache();

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // Perform search when query or options change
  useEffect(() => {
    if (!textCache || !currentQuery.trim()) {
      return;
    }

    setIsSearching(true);

    // Use requestAnimationFrame to ensure UI update before potentially slow search
    const rafId = requestAnimationFrame(() => {
      const results = searchBook(
        textCache.chapters,
        currentQuery,
        searchOptions,
      );
      setSearchResults(results);
      setIsSearching(false);
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [textCache, currentQuery, searchOptions]);

  // Search function with optional options update
  const search = useCallback((query: string, options?: SearchOptions) => {
    setCurrentQuery(query);
    if (options) {
      setSearchOptions(options);
    }

    // Clear results immediately if query is empty
    if (!query.trim()) {
      setSearchResults(null);
    }
  }, []);

  // Clear search
  const clearSearch = useCallback(() => {
    setCurrentQuery("");
    setSearchResults(null);
  }, []);

  const isReady = useMemo(() => textCache !== null, [textCache]);

  return {
    searchResults,
    isExtracting,
    isSearching,
    extractionProgress,
    isReady,
    error,
    search,
    clearSearch,
    currentQuery,
  };
}
