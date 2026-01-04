import { BookCard } from "@/components/BookCard";
import { ContinueReadingCarousel } from "@/components/ContinueReadingCarousel";
import { DuplicateBookDialog } from "@/components/DuplicateBookDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useSync } from "@/hooks/use-sync";
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth-client";
import { addBookFromFile, DuplicateBookError } from "@/lib/book-service";
import type { Book, SyncedBook } from "@/lib/db";
import {
  Cloud,
  CloudOff,
  Highlighter,
  Library as LibraryIcon,
  LogOut,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

export function Library() {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [duplicateBook, setDuplicateBook] = useState<Book | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const {
    data: booksData,
    isLoading,
    refetch: refetchBooks,
  } = useBooksWithStatuses();
  const { isSyncing, triggerSync, deleteBook: syncDeleteBook } = useSync();
  // Handle Google Sign In
  const handleGoogleSignIn = async () => {
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
      });
    } catch (error) {
      console.error("Error signing in:", error);

      if (error instanceof DuplicateBookError) {
        setDuplicateBook(error.existingBook);
        setShowDuplicateDialog(true);
      } else {
        toast({
          title: "Error",
          description: "Failed to sign in with Google",
          variant: "destructive",
        });
      }
    }
  };

  // Handle Sign Out
  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      toast({
        title: "Signed out",
        description: "You have been signed out successfully",
      });
    } catch (error) {
      console.error("Error signing out:", error);
      toast({
        title: "Error",
        description: "Failed to sign out",
        variant: "destructive",
      });
    }
  };

  // Get user initials for avatar fallback
  const getUserInitials = () => {
    if (!user?.name) return "U";
    return user.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // Refetch books when needed
  const loadBooks = useCallback(async () => {
    await refetchBooks();
  }, [refetchBooks]);

  // Handle file selection (supports multiple files)
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Filter to only .epub files
    const allFiles = Array.from(files);
    const epubFiles = allFiles.filter((file) =>
      file.name.toLowerCase().endsWith(".epub")
    );
    const nonEpubCount = allFiles.length - epubFiles.length;

    if (epubFiles.length === 0) {
      toast({
        title: "Invalid files",
        description: "Please select EPUB files only",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    let lastDuplicateBook: Book | null = null;

    for (const file of epubFiles) {
      try {
        await addBookFromFile(file);
        successCount++;
      } catch (error) {
        console.error("Error adding book:", error);

        if (error instanceof DuplicateBookError) {
          duplicateCount++;
          lastDuplicateBook = error.existingBook;
        } else {
          errorCount++;
        }
      }
    }

    // Build summary message
    const parts: string[] = [];
    if (successCount > 0) {
      parts.push(
        `${successCount} book${successCount > 1 ? "s" : ""} added`
      );
    }
    if (duplicateCount > 0) {
      parts.push(
        `${duplicateCount} skipped (already in library)`
      );
    }
    if (errorCount > 0) {
      parts.push(`${errorCount} failed`);
    }
    if (nonEpubCount > 0) {
      parts.push(
        `${nonEpubCount} non-EPUB file${nonEpubCount > 1 ? "s" : ""} ignored`
      );
    }

    // Show appropriate toast
    if (successCount > 0) {
      toast({
        title: "Import complete",
        description: parts.join(" · "),
      });
    } else if (duplicateCount > 0 && epubFiles.length === 1 && lastDuplicateBook) {
      // Single duplicate file - show the dialog for better UX
      setDuplicateBook(lastDuplicateBook);
      setShowDuplicateDialog(true);
    } else {
      toast({
        title: "Import failed",
        description: parts.join(" · "),
        variant: "destructive",
      });
    }

    // Reload books if any were added
    if (successCount > 0) {
      await loadBooks();
    }

    setIsProcessing(false);
  };

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
    await handleFileSelect(files);
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

  // Handle manual sync trigger
  const handleManualSync = async () => {
    try {
      await triggerSync();
      toast({
        title: "Library synced",
      });
    } catch (error) {
      console.error("Error syncing:", error);
      toast({
        title: "Sync failed",
        description: "Failed to synchronize library",
        variant: "destructive",
      });
    }
  };

  // Handle file input button click
  const handleAddBookClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".epub";
    input.multiple = true;
    // WebKit browsers require the input to be in the DOM for the onchange event to fire
    input.style.position = "absolute";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);

    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      handleFileSelect(target.files);
      // Clean up the input element after selection
      document.body.removeChild(input);
    };

    // Also clean up if the user cancels the file picker (WebKit fires a cancel event)
    input.addEventListener("cancel", () => {
      document.body.removeChild(input);
    });

    input.click();
  };

  // Filter books by search query
  const filterBySearch = (book: SyncedBook) =>
    book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    book.author.toLowerCase().includes(searchQuery.toLowerCase());

  // Get categorized and filtered books
  const continueReadingBooks =
    booksData?.categorized.continueReading.filter(filterBySearch) ?? [];
  const libraryBooks =
    booksData?.categorized.library.filter(filterBySearch) ?? [];
  const finishedBooks =
    booksData?.categorized.finished.filter(filterBySearch) ?? [];
  const filteredBooks = [
    ...continueReadingBooks,
    ...libraryBooks,
    ...finishedBooks,
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground text-sm">Loading library...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Duplicate Book Dialog */}
      {duplicateBook && (
        <DuplicateBookDialog
          open={showDuplicateDialog}
          onOpenChange={setShowDuplicateDialog}
          existingBook={duplicateBook}
        />
      )}

      <div
        className="min-h-screen bg-background transition-colors duration-300"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag Overlay */}
        {isDragging && (
          <div className="fixed inset-0 z-50 bg-primary/10 backdrop-blur-sm border-4 border-primary border-dashed m-4 rounded-xl flex items-center justify-center pointer-events-none">
            <div className="text-center bg-background/80 p-8 rounded-2xl shadow-xl backdrop-blur-md">
              <Upload className="h-16 w-16 text-primary mx-auto mb-4 animate-bounce" />
              <h3 className="text-2xl font-bold text-primary mb-2">
                Drop EPUB to Add
              </h3>
              <p className="text-muted-foreground">
                Release to add to your library
              </p>
            </div>
          </div>
        )}

        <div className="max-w-[1400px] mx-auto px-6 py-8 md:px-10 md:py-12">
          {/* Header */}
          <header className="flex items-center gap-4 w-full md:w-auto mb-8 md:mb-12">
            <div className="flex-1 hidden md:block"></div>
            <div className="flex gap-2 w-full md:w-max">
              <Button
                onClick={handleAddBookClick}
                disabled={isProcessing}
                size={"icon-lg"}
                className="gap-2 transition-all active:scale-95 rounded-md"
                variant={"ghost"}
              >
                {isProcessing ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search books..."
                  className="pl-9 transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="md:flex-1 flex justify-end gap-2 items-center">
              {/* Highlights Link */}
              <Link to="/highlights">
                <Button variant="ghost" size="icon-lg" title="View highlights">
                  <Highlighter className="size-5" />
                </Button>
              </Link>
              {/* Sync Status & Manual Sync Button (only when authenticated) */}
              {isAuthenticated && (
                <Button
                  variant="ghost"
                  size="icon-lg"
                  onClick={handleManualSync}
                  disabled={isSyncing}
                  title={isSyncing ? "Syncing..." : "Sync library"}
                >
                  {isSyncing ? (
                    <RefreshCw className="size-5 animate-spin" />
                  ) : navigator.onLine ? (
                    <Cloud className="size-5 translate-y-0.5" />
                  ) : (
                    <CloudOff className="size-5 text-muted-foreground translate-y-0.5" />
                  )}
                </Button>
              )}

              {/* Auth Section */}
              {isAuthLoading ? (
                <div className="w-8 h-8 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                </div>
              ) : isAuthenticated && user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="relative"
                      size={"icon-lg"}
                    >
                      <Avatar className="size-7">
                        <AvatarImage
                          src={user.image || undefined}
                          alt={user.name || "User"}
                        />
                        <AvatarFallback>{getUserInitials()}</AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">
                          {user.name}
                        </p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/sessions">
                        <Monitor className="mr-2 h-4 w-4" />
                        <span>Sessions</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleSignOut}>
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Sign out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  onClick={handleGoogleSignIn}
                  variant="outline"
                  className="gap-2"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span>Sign in with Google</span>
                </Button>
              )}
            </div>
          </header>

          {/* Books Grid */}
          {filteredBooks.length > 0 ? (
            <div className="space-y-12 fade-in animate-in duration-300">
              {/* Continue Reading Carousel */}
              {continueReadingBooks.length > 0 && (
                <ContinueReadingCarousel
                  books={continueReadingBooks}
                />
              )}

              {/* Books Section */}
              {libraryBooks.length > 0 && (
                <section>
                  <h2 className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-3 -mx-6 px-6 md:-mx-10 md:px-10 text-xs font-medium uppercase tracking-tight text-muted-foreground mb-3">
                    Books
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-8 gap-y-12">
                    {libraryBooks.map((book) => (
                      <BookCard
                        key={book.id}
                        book={book}
                        onDelete={handleDeleteBook}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Finished Section - shown at the bottom */}
              {finishedBooks.length > 0 && (
                <section>
                  <h2 className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-3 -mx-6 px-6 md:-mx-10 md:px-10 text-xs font-medium uppercase tracking-tight text-muted-foreground mb-3">
                    Finished
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-8 gap-y-12">
                    {finishedBooks.map((book) => (
                      <BookCard
                        key={book.id}
                        book={book}
                        onDelete={handleDeleteBook}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              {/* Animated floating books illustration */}
              <div className="relative mb-8">
                {/* Background glow */}
                <div className="absolute inset-0 bg-primary/5 blur-3xl rounded-full scale-150" />

                {/* Floating book stack */}
                <div className="relative">
                  {/* Back book */}
                  <div
                    className="absolute -left-3 -top-2 w-16 h-24 rounded-r-md rounded-l-sm bg-gradient-to-br from-muted to-muted-foreground/20 shadow-lg transform -rotate-12 animate-[float_3s_ease-in-out_infinite]"
                    style={{ animationDelay: "-0.5s" }}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-r from-black/10 to-transparent" />
                  </div>

                  {/* Middle book */}
                  <div
                    className="absolute left-2 top-1 w-16 h-24 rounded-r-md rounded-l-sm bg-gradient-to-br from-secondary to-secondary-foreground/10 shadow-lg transform rotate-6 animate-[float_3s_ease-in-out_infinite]"
                    style={{ animationDelay: "-1s" }}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-r from-black/10 to-transparent" />
                  </div>

                  {/* Front book with icon */}
                  <div className="relative w-20 h-28 rounded-r-md rounded-l-sm bg-gradient-to-br from-primary/10 to-primary/5 shadow-xl ring-1 ring-primary/10 animate-[float_3s_ease-in-out_infinite] flex items-center justify-center">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-r from-black/15 to-transparent rounded-l-sm" />
                    <LibraryIcon className="h-8 w-8 text-muted-foreground/40" />
                  </div>
                </div>
              </div>

              <h3 className="text-xl font-semibold text-foreground mb-2">
                {searchQuery ? "No books found" : "Your library is empty"}
              </h3>
              <p className="text-muted-foreground max-w-sm mx-auto mb-8">
                {searchQuery
                  ? `No results for "${searchQuery}"`
                  : "Drag and drop an EPUB file here, or click the button below to add your first book."}
              </p>
              {!searchQuery && (
                <Button
                  onClick={handleAddBookClick}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" />
                  Import EPUB
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
