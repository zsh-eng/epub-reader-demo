import { useToast } from "@/hooks/use-toast";
import {
  getAllBooks,
  getBook,
  getReadingProgress,
  type Book,
  type ReadingProgress,
} from "@/lib/db";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export interface UseBookLoaderReturn {
  /** The loaded book data */
  book: Book | null;
  /** Initial reading progress from database */
  initialProgress: ReadingProgress | null;
  /** Whether the book is currently loading */
  isLoading: boolean;
}

/**
 * Query key factory for book queries
 */
export const bookKeys = {
  all: ["books"] as const,
  list: () => [...bookKeys.all, "list"] as const,
  detail: (bookId: string) => [...bookKeys.all, bookId] as const,
  progress: (bookId: string) => [...bookKeys.all, bookId, "progress"] as const,
};

/**
 * Hook for querying all books in the library
 */
export function useBooks() {
  return useQuery({
    queryKey: bookKeys.list(),
    queryFn: async () => {
      return await getAllBooks();
    },
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook for querying book data
 */
function useBook(bookId: string | undefined) {
  return useQuery({
    queryKey: bookKeys.detail(bookId ?? ""),
    queryFn: async () => {
      if (!bookId) {
        throw new Error("No book ID provided");
      }
      const book = await getBook(bookId);
      if (!book) {
        throw new Error("Book not found");
      }
      return book;
    },
    enabled: !!bookId,
    staleTime: 10 * 60 * 1000, // Consider data fresh for 10 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Hook for querying reading progress
 */
function useReadingProgress(bookId: string | undefined) {
  return useQuery({
    queryKey: bookKeys.progress(bookId ?? ""),
    queryFn: async () => {
      if (!bookId) {
        return null;
      }
      const progress = await getReadingProgress(bookId);
      return progress ?? null;
    },
    enabled: !!bookId,
    staleTime: 1 * 60 * 1000, // Consider data fresh for 1 minute
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Hook for loading book data and initial reading progress.
 *
 * This hook is intentionally simple - it only handles:
 * - Loading the book from the database
 * - Loading the initial reading progress
 * - Navigation/error handling if book not found
 *
 * Scroll restoration is handled separately by the useScrollTarget and useProgressPersistence hooks.
 */
export function useBookLoader(bookId: string | undefined): UseBookLoaderReturn {
  const navigate = useNavigate();
  const { toast } = useToast();

  const bookQuery = useBook(bookId);
  const progressQuery = useReadingProgress(bookId);

  // Handle errors and navigation
  useEffect(() => {
    if (!bookId) {
      toast({
        title: "Error",
        description: "No book ID provided",
        variant: "destructive",
      });
      navigate("/");
      return;
    }

    if (bookQuery.error) {
      console.error("Error loading book:", bookQuery.error);
      toast({
        title: "Error",
        description:
          bookQuery.error instanceof Error
            ? bookQuery.error.message
            : "Failed to load book",
        variant: "destructive",
      });
      navigate("/");
    }
  }, [bookId, bookQuery.error, navigate, toast]);

  const isLoading = bookQuery.isLoading || progressQuery.isLoading;

  return {
    book: bookQuery.data ?? null,
    initialProgress: progressQuery.data ?? null,
    isLoading,
  };
}
