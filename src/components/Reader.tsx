import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  getBook,
  getBookFile,
  getReadingProgress,
  saveReadingProgress,
  type Book,
  type TOCItem,
} from "@/lib/db";
import {
  cleanupResourceUrls,
  processEmbeddedResources,
} from "@/lib/epub-resource-utils";
import { ArrowLeft, ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

export function Reader() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [book, setBook] = useState<Book | null>(null);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [chapterContent, setChapterContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isTOCOpen, setIsTOCOpen] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const lastScrollProgress = useRef<number>(0);
  const resourceUrlsRef = useRef<Map<string, string>>(new Map());

  // Load book data
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
        if (progress) {
          setCurrentChapterIndex(progress.currentSpineIndex);
        }
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

  // Load chapter content
  const loadChapterContent = useCallback(async () => {
    if (!book || !bookId) return;

    try {
      const spineItem = book.spine[currentChapterIndex];
      if (!spineItem) {
        console.error("Spine item not found for index:", currentChapterIndex);
        return;
      }

      // Find the manifest item
      const manifestItem = book.manifest.find(
        (item) => item.id === spineItem.idref,
      );
      if (!manifestItem) {
        console.error("Manifest item not found for idref:", spineItem.idref);
        return;
      }

      // Load the file content
      const bookFile = await getBookFile(bookId, manifestItem.href);
      if (!bookFile) {
        console.error("Book file not found:", manifestItem.href);
        setChapterContent("<p>Chapter content not found.</p>");
        return;
      }

      // Clean up previous resource URLs
      cleanupResourceUrls(resourceUrlsRef.current);

      // Convert blob to text
      const text = await bookFile.content.text();

      // Process embedded resources (images, stylesheets, fonts, etc.)
      const { html } = await processEmbeddedResources({
        content: text,
        mediaType: manifestItem.mediaType,
        basePath: manifestItem.href,
        loadResource: async (path: string) => {
          const resourceFile = await getBookFile(bookId, path);
          return resourceFile?.content || null;
        },
        resourceUrlMap: resourceUrlsRef.current,
      });

      setChapterContent(html);

      // Reset scroll position when chapter changes
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
    } catch (error) {
      console.error("Error loading chapter:", error);
      setChapterContent("<p>Error loading chapter content.</p>");
    }
  }, [book, bookId, currentChapterIndex]);

  useEffect(() => {
    loadChapterContent();

    // Capture the current map reference for cleanup
    const urlsMap = resourceUrlsRef.current;

    // Cleanup function to revoke object URLs when component unmounts
    return () => {
      cleanupResourceUrls(urlsMap);
    };
  }, [loadChapterContent]);

  // Save reading progress periodically
  useEffect(() => {
    if (!bookId || !book) return;

    const saveProgress = async () => {
      const scrollProgress = contentRef.current
        ? contentRef.current.scrollTop /
          (contentRef.current.scrollHeight - contentRef.current.clientHeight)
        : 0;

      // Only save if progress changed significantly
      if (Math.abs(scrollProgress - lastScrollProgress.current) > 0.01) {
        lastScrollProgress.current = scrollProgress;
        await saveReadingProgress({
          id: bookId,
          bookId,
          currentSpineIndex: currentChapterIndex,
          scrollProgress: isNaN(scrollProgress) ? 0 : scrollProgress,
          lastRead: new Date(),
        });
      }
    };

    const interval = setInterval(saveProgress, 3000);
    return () => clearInterval(interval);
  }, [bookId, book, currentChapterIndex]);

  // Navigation handlers
  const goToPreviousChapter = useCallback(() => {
    if (currentChapterIndex > 0) {
      setCurrentChapterIndex((prev) => prev - 1);
    }
    window.scrollTo({
      top: 0,
      behavior: "instant",
    });
  }, [currentChapterIndex]);

  const goToNextChapter = useCallback(() => {
    if (book && currentChapterIndex < book.spine.length - 1) {
      setCurrentChapterIndex((prev) => prev + 1);
      window.scrollTo({
        top: 0,
        behavior: "instant",
      });
    }
  }, [book, currentChapterIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPreviousChapter();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNextChapter();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentChapterIndex, book, goToPreviousChapter, goToNextChapter]);

  const goToChapterByHref = (href: string) => {
    if (!book) return;

    // Find the spine index for this href
    const manifestItem = book.manifest.find(
      (item) => item.href === href || item.href.endsWith(href),
    );
    if (!manifestItem) {
      console.error("Manifest item not found for href:", href);
      return;
    }

    const spineIndex = book.spine.findIndex(
      (item) => item.idref === manifestItem.id,
    );
    if (spineIndex !== -1) {
      setCurrentChapterIndex(spineIndex);
      setIsTOCOpen(false);
    }
  };

  const handleBackToLibrary = () => {
    navigate("/");
  };

  // Render TOC items recursively
  const renderTOCItems = (items: TOCItem[], level = 0) => {
    return items.map((item, index) => (
      <div key={`${level}-${index}`} style={{ paddingLeft: `${level * 16}px` }}>
        <button
          onClick={() => goToChapterByHref(item.href)}
          className="w-full text-left px-3 py-2 hover:bg-gray-100 rounded-none transition-colors text-sm"
        >
          {item.label}
        </button>
        {item.children &&
          item.children.length > 0 &&
          renderTOCItems(item.children, level + 1)}
      </div>
    ));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading book...</p>
        </div>
      </div>
    );
  }

  if (!book) {
    return null;
  }

  const currentChapterTitle =
    book.toc[currentChapterIndex]?.label ||
    `Chapter ${currentChapterIndex + 1}`;
  const hasPreviousChapter = currentChapterIndex > 0;
  const hasNextChapter = currentChapterIndex < book.spine.length - 1;

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-10">
        {/* Hamburger Menu */}
        <Sheet open={isTOCOpen} onOpenChange={setIsTOCOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Table of contents">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] sm:w-[400px]">
            <SheetHeader>
              <SheetTitle>Table of Contents</SheetTitle>
            </SheetHeader>
            <SheetDescription className="overflow-scroll px-2">
              {book.toc && book.toc.length > 0 ? (
                <div className="space-y-1">{renderTOCItems(book.toc)}</div>
              ) : (
                <p className="text-sm text-gray-500 px-3">
                  No table of contents available
                </p>
              )}
            </SheetDescription>
          </SheetContent>
        </Sheet>

        {/* Back to Library Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBackToLibrary}
          aria-label="Back to library"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        {/* Book Info */}
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-base truncate">{book.title}</h1>
          <p className="text-xs text-gray-600 truncate">
            {currentChapterTitle}
          </p>
        </div>

        {/* Chapter Progress */}
        <div className="text-xs text-gray-500 hidden sm:block">
          {currentChapterIndex + 1} / {book.spine.length}
        </div>
      </header>

      {/* Scrollable Chapter Content */}
      <ScrollArea className="flex-1">
        <div
          key={currentChapterIndex}
          ref={contentRef}
          className="reader-content max-w-[80ch] mx-auto px-6 py-8 sm:px-8 md:px-12"
          dangerouslySetInnerHTML={{ __html: chapterContent }}
        />
      </ScrollArea>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between px-4 py-4 border-t border-gray-200 bg-white">
        <Button
          variant="outline"
          onClick={goToPreviousChapter}
          disabled={!hasPreviousChapter}
          className="gap-2 w-28"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>

        <div className="text-sm text-gray-600">
          Chapter {currentChapterIndex + 1} of {book.spine.length}
        </div>

        <Button
          variant="outline"
          onClick={goToNextChapter}
          disabled={!hasNextChapter}
          className="gap-2 w-28"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
