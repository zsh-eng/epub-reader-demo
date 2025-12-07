import { useToast } from "@/hooks/use-toast";
import {
  getBook,
  getReadingProgress,
  type Book,
  type ReadingProgress,
} from "@/lib/db";
import { useEffect, useState } from "react";
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
 * Hook for loading book data and initial reading progress.
 *
 * This hook is intentionally simple - it only handles:
 * - Loading the book from the database
 * - Loading the initial reading progress
 * - Navigation/error handling if book not found
 *
 * Scroll restoration is handled separately by the ScrollRestoration component.
 */
export function useBookLoader(bookId: string | undefined): UseBookLoaderReturn {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [book, setBook] = useState<Book | null>(null);
  const [initialProgress, setInitialProgress] =
    useState<ReadingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadBook = async () => {
      if (!bookId) {
        toast({
          title: "Error",
          description: "No book ID provided",
          variant: "destructive",
        });
        navigate("/");
        return;
      }

      try {
        const bookData = await getBook(bookId);
        if (!bookData) {
          toast({
            title: "Error",
            description: "Book not found",
            variant: "destructive",
          });
          navigate("/");
          return;
        }

        setBook(bookData);

        // Load reading progress (may be null for new books)
        const progress = await getReadingProgress(bookId);
        setInitialProgress(progress ?? null);
      } catch (error) {
        console.error("Error loading book:", error);
        toast({
          title: "Error",
          description: "Failed to load book",
          variant: "destructive",
        });
        navigate("/");
      } finally {
        setIsLoading(false);
      }
    };

    loadBook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  return {
    book,
    initialProgress,
    isLoading,
  };
}
