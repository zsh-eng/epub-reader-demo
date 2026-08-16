import { useAppShellReady } from "@/components/AppShell";
import { BookCard } from "@/components/BookCard";
import { Button } from "@/components/ui/button";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useEpubImport } from "@/hooks/use-epub-import";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import { useSync } from "@/hooks/use-sync";
import { useToast } from "@/hooks/use-toast";
import {
  prefetchReaderBook,
  prefetchReaderBooks,
} from "@/components/Reader/data/reader-cache/prefetch";
import type { Book, SyncedBook } from "@/lib/db";
import { compareBooksByDateAddedDesc } from "@/lib/library-sort";
import { useQueryClient } from "@tanstack/react-query";
import { Library as LibraryIcon, Upload } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

export function Library() {
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  const { importFiles, isProcessing, openFilePicker } = useEpubImport();
  const queryClient = useQueryClient();

  const { data: booksData } = useBooksWithStatuses();
  const { deleteBook: syncDeleteBook } = useSync();

  useEffect(() => {
    const books = booksData?.categorized.continueReading ?? [];
    if (books.length === 0) return;

    void prefetchReaderBooks(queryClient, books, {
      includeArtifacts: false,
    });
  }, [booksData?.categorized.continueReading, queryClient]);

  // Handle drag and drop
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only set dragging to false if leaving the drop zone completely
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    await importFiles(files);
  };

  // Handle book deletion (uses sync service when authenticated)
  const handleDeleteBook = async (bookId: string) => {
    try {
      await syncDeleteBook(bookId);
      toast({
        title: "Success",
        description: "Book removed from library",
      });
      // Refetch is handled by query invalidation in sync service
    } catch (error) {
      console.error("Error deleting book:", error);
      toast({
        title: "Error",
        description: "Failed to remove book",
        variant: "destructive",
      });
    }
  };

  const handlePrefetchBook = useCallback(
    (book: Book) => {
      void prefetchReaderBook(queryClient, book, {
        includeArtifacts: true,
        artifactLimit: 2,
      });
    },
    [queryClient],
  );

  const { continueReadingBooks, allBooks } = useMemo(() => {
    if (!booksData) {
      return {
        continueReadingBooks: [] as SyncedBook[],
        allBooks: [] as SyncedBook[],
      };
    }

    const normalizedSearch = searchQuery.toLowerCase();
    const filterBySearch = (book: SyncedBook) =>
      book.title.toLowerCase().includes(normalizedSearch) ||
      book.author.toLowerCase().includes(normalizedSearch);
    const continueReading =
      booksData.categorized.continueReading.filter(filterBySearch);
    const library = booksData.categorized.library.filter(filterBySearch);
    const finished = booksData.categorized.finished.filter(filterBySearch);

    return {
      continueReadingBooks: continueReading,
      // The source lists are sorted independently. Sort the combined section
      // again so it remains globally ordered by date added.
      allBooks: [...library, ...finished].sort(compareBooksByDateAddedDesc),
    };
  }, [booksData, searchQuery]);
  const displayedBooks = useMemo(
    () => [...continueReadingBooks, ...allBooks],
    [allBooks, continueReadingBooks],
  );
  const { coverUrls, initialCoversReady, requestCover } =
    useLibraryCoverUrls(displayedBooks);
  const hasAnyBooks = continueReadingBooks.length > 0 || allBooks.length > 0;
  const booksLoaded = booksData !== undefined;
  const [fontsReady, setFontsReady] = useState(
    () =>
      typeof document === "undefined" ||
      !("fonts" in document) ||
      document.fonts.status === "loaded",
  );
  const [libraryDisplayReady, setLibraryDisplayReady] = useState(false);

  useEffect(() => {
    if (fontsReady || !("fonts" in document)) return;

    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [fontsReady]);

  // This latch makes the first library paint atomic. It does not hide the page
  // again for later interactions such as search, sync, or status changes.
  useLayoutEffect(() => {
    if (booksLoaded && initialCoversReady && fontsReady) {
      setLibraryDisplayReady(true);
    }
  }, [booksLoaded, fontsReady, initialCoversReady]);

  useAppShellReady(libraryDisplayReady);

  return (
    <div
      className={`min-h-full bg-background ${libraryDisplayReady ? "" : "invisible"}`}
      aria-busy={!libraryDisplayReady}
      aria-hidden={!libraryDisplayReady}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-primary/10 backdrop-blur-sm border-4 border-primary border-dashed m-4 rounded-xl flex items-center justify-center pointer-events-none">
          <div className="text-center bg-background/80 p-8 rounded-2xl shadow-xl backdrop-blur-md">
            <Upload className="h-16 w-16 text-primary mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-primary mb-2">
              Drop EPUB to Add
            </h3>
            <p className="text-muted-foreground">
              Release to add to your library
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="px-4 pt-16 pb-6 md:px-8 md:pt-20 md:pb-10">
        {/* Hero Search Bar */}
        <div className="max-w-3xl mb-10 md:mb-16">
          <input
            type="text"
            placeholder="Search my library..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent border-none outline-none text-xl md:text-4xl lg:text-5xl 2xl:text-7xl md:font-serif md:italic placeholder:text-muted-foreground/40 md:placeholder:italic text-foreground"
          />
        </div>

        {/* Books Content */}
        {hasAnyBooks ? (
          libraryDisplayReady ? (
            <div className="space-y-8">
              {/* Continue Reading Section */}
              {continueReadingBooks.length > 0 && (
                <section>
                  <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-6 px-1">
                    Continue Reading
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-6 md:gap-8">
                    {continueReadingBooks.map((book) => (
                      <BookCard
                        key={book.id}
                        book={book}
                        status={booksData?.statuses.get(book.id) ?? null}
                        coverUrl={coverUrls.get(book.id)}
                        onDelete={handleDeleteBook}
                        onCoverRequest={requestCover}
                        onPrefetch={handlePrefetchBook}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Section Divider - only show if both sections have content */}
              {continueReadingBooks.length > 0 && allBooks.length > 0 && (
                <div className="section-divider">
                  <span className="section-divider-flair">§</span>
                </div>
              )}

              {/* All Books Section */}
              {allBooks.length > 0 && (
                <section>
                  <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-6 px-1">
                    All Books
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-6 md:gap-8">
                    {allBooks.map((book) => (
                      <BookCard
                        key={book.id}
                        book={book}
                        status={booksData?.statuses.get(book.id) ?? null}
                        coverUrl={coverUrls.get(book.id)}
                        onDelete={handleDeleteBook}
                        onCoverRequest={requestCover}
                        onPrefetch={handlePrefetchBook}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : null
        ) : booksLoaded ? (
          <div className="flex flex-col items-center justify-center py-16 sm:py-20 md:py-24 lg:py-32 xl:py-40 2xl:py-48 text-center">
            {/* Static book-stack illustration */}
            <div className="relative mb-6 sm:mb-8 md:mb-10 lg:mb-12 xl:mb-14 2xl:mb-16">
              {/* Background glow */}
              <div className="absolute inset-0 bg-primary/5 blur-3xl rounded-full scale-150" />

              {/* Floating book stack */}
              <div className="relative">
                {/* Back book */}
                <div className="absolute -left-2 sm:-left-3 md:-left-4 lg:-left-5 xl:-left-6 2xl:-left-8 -top-1.5 sm:-top-2 md:-top-3 lg:-top-4 xl:-top-5 2xl:-top-6 w-12 h-18 sm:w-16 sm:h-24 md:w-20 md:h-30 lg:w-24 lg:h-36 xl:w-28 xl:h-42 2xl:w-36 2xl:h-54 rounded-r-md rounded-l-sm bg-gradient-to-br from-muted to-muted-foreground/20 shadow-lg transform -rotate-12">
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 sm:w-1 md:w-1.5 bg-gradient-to-r from-black/10 to-transparent" />
                </div>

                {/* Middle book */}
                <div className="absolute left-1.5 sm:left-2 md:left-3 lg:left-4 xl:left-5 2xl:left-6 top-0.5 sm:top-1 md:top-1.5 lg:top-2 xl:top-3 2xl:top-4 w-12 h-18 sm:w-16 sm:h-24 md:w-20 md:h-30 lg:w-24 lg:h-36 xl:w-28 xl:h-42 2xl:w-36 2xl:h-54 rounded-r-md rounded-l-sm bg-gradient-to-br from-secondary to-secondary-foreground/10 shadow-lg transform rotate-6">
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 sm:w-1 md:w-1.5 bg-gradient-to-r from-black/10 to-transparent" />
                </div>

                {/* Front book with icon */}
                <div className="relative w-16 h-22 sm:w-20 sm:h-28 md:w-24 md:h-36 lg:w-32 lg:h-44 xl:w-36 xl:h-52 2xl:w-48 2xl:h-68 rounded-r-md rounded-l-sm bg-gradient-to-br from-primary/10 to-primary/5 shadow-xl ring-1 ring-primary/10 flex items-center justify-center">
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 sm:w-1 md:w-1.5 bg-gradient-to-r from-black/15 to-transparent rounded-l-sm" />
                  <LibraryIcon className="h-6 w-6 sm:h-8 sm:w-8 md:h-10 md:w-10 lg:h-12 lg:w-12 xl:h-14 xl:w-14 2xl:h-18 2xl:w-18 text-muted-foreground/40" />
                </div>
              </div>
            </div>

            <h3 className="font-serif italic text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl 2xl:text-6xl text-foreground mb-2 md:mb-3 lg:mb-4">
              {searchQuery
                ? "Nothing on these shelves"
                : "Your library is empty"}
            </h3>
            <p className="text-sm sm:text-base md:text-lg lg:text-xl xl:text-2xl 2xl:text-3xl text-muted-foreground max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg xl:max-w-xl 2xl:max-w-2xl mx-auto mb-6 sm:mb-8 md:mb-10 lg:mb-12">
              {searchQuery
                ? `No results for "${searchQuery}"`
                : "Drag and drop an EPUB file here, or click the button below to add your first book."}
            </p>
            {!searchQuery && (
              <Button
                onClick={openFilePicker}
                disabled={isProcessing}
                className="gap-2 text-sm sm:text-base md:text-lg lg:text-xl xl:text-2xl h-9 sm:h-10 md:h-12 lg:h-14 xl:h-16 px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10"
              >
                <Upload className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6 lg:h-7 lg:w-7 xl:h-8 xl:w-8" />
                Import EPUB
              </Button>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
