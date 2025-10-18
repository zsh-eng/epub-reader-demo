import { useToast } from "@/hooks/use-toast";
import { getBook, getReadingProgress, type Book } from "@/lib/db";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export interface UseBookLoaderReturn {
  book: Book | null;
  currentChapterIndex: number;
  setCurrentChapterIndex: (index: number) => void;
  isLoading: boolean;
  lastScrollProgress: React.MutableRefObject<number>;
}

export function useBookLoader(bookId: string | undefined): UseBookLoaderReturn {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [book, setBook] = useState<Book | null>(null);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const lastScrollProgress = useRef<number>(0);

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

        // Load reading progress
        const progress = await getReadingProgress(bookId);
        if (!progress) return;

        setCurrentChapterIndex(progress.currentSpineIndex);
        lastScrollProgress.current = progress.scrollProgress;
        console.log("scroll progress", progress.scrollProgress);

        // Wait for content to be ready before scrolling
        const waitForContent = (callback: () => void, maxAttempts = 20) => {
          let attempts = 0;
          const check = () => {
            const scrollHeight = document.documentElement.scrollHeight;
            const clientHeight = window.innerHeight;

            if (scrollHeight > clientHeight || attempts >= maxAttempts) {
              callback();
            } else {
              attempts++;
              requestAnimationFrame(check);
            }
          };
          requestAnimationFrame(check);
        };

        waitForContent(() => {
          const scrollHeight = document.documentElement.scrollHeight;
          const clientHeight = window.innerHeight;
          const maxScroll = scrollHeight - clientHeight;
          window.scrollTo({
            top: maxScroll * progress.scrollProgress,
            behavior: "smooth",
          });
        });
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
    currentChapterIndex,
    setCurrentChapterIndex,
    isLoading,
    lastScrollProgress,
  };
}
