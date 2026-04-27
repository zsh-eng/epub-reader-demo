import { BookCard } from "@/components/BookCard";
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
import { useAuth } from "@/hooks/use-auth";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { useSync } from "@/hooks/use-sync";
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth-client";
import { addBookFromFile, DuplicateBookError } from "@/lib/book-service";
import type { Book, SyncedBook } from "@/lib/db";
import {
  prefetchReaderBook,
  prefetchReaderBooks,
} from "@/components/Reader/data/reader-cache/prefetch";
import { useQueryClient } from "@tanstack/react-query";
import {
  Cloud,
  CloudOff,
  Highlighter,
  Library as LibraryIcon,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

export function Library() {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [duplicateBook, setDuplicateBook] = useState<Book | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();

  const {
    data: booksData,
    isLoading,
    refetch: refetchBooks,
  } = useBooksWithStatuses();
  const { isSyncing, triggerSync, deleteBook: syncDeleteBook } = useSync();
  const { settings, updateSettings } = useReaderSettings();

  useEffect(() => {
    const books = booksData?.categorized.continueReading ?? [];
    if (books.length === 0) return;

    void prefetchReaderBooks(queryClient, books, {
      includeArtifacts: false,
    });
  }, [booksData?.categorized.continueReading, queryClient]);

  // Determine if current theme is dark
  const isDarkTheme =
    settings.theme === "dark" || settings.theme === "flexoki-dark";

  // Handle theme toggle: flexoki-light <-> flexoki-dark, light <-> dark
  const handleThemeToggle = () => {
    const themeMap: Record<string, string> = {
      "flexoki-light": "flexoki-dark",
      "flexoki-dark": "flexoki-light",
      light: "dark",
      dark: "light",
    };
    const newTheme =
      themeMap[settings.theme] || (isDarkTheme ? "light" : "dark");
    updateSettings({
      theme: newTheme as "light" | "dark" | "flexoki-light" | "flexoki-dark",
    });
  };

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
      file.name.toLowerCase().endsWith(".epub"),
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
      parts.push(`${successCount} book${successCount > 1 ? "s" : ""} added`);
    }
    if (duplicateCount > 0) {
      parts.push(`${duplicateCount} skipped (already in library)`);
    }
    if (errorCount > 0) {
      parts.push(`${errorCount} failed`);
    }
    if (nonEpubCount > 0) {
      parts.push(
        `${nonEpubCount} non-EPUB file${nonEpubCount > 1 ? "s" : ""} ignored`,
      );
    }

    // Show appropriate toast
    if (successCount > 0) {
      toast({
        title: "Import complete",
        description: parts.join(" · "),
      });
    } else if (
      duplicateCount > 0 &&
      epubFiles.length === 1 &&
      lastDuplicateBook
    ) {
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

  const handlePrefetchBook = useCallback(
    (book: Book) => {
      void prefetchReaderBook(queryClient, book, {
        includeArtifacts: true,
      });
    },
    [queryClient],
  );

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

  // Combine library and finished books into "All Books" section
  const allBooks = [...libraryBooks, ...finishedBooks];
  const hasAnyBooks = continueReadingBooks.length > 0 || allBooks.length > 0;

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

        {/* Left Side Icon Bar - Desktop Only */}
        <aside className="hidden md:flex fixed left-6 top-1/2 -translate-y-1/2 flex-col gap-2 z-40">
          {/* Add Book */}
          <Button
            onClick={handleAddBookClick}
            disabled={isProcessing}
            size="icon"
            variant="ghost"
            className="h-10 w-10 rounded-full"
            title="Add book"
          >
            {isProcessing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
            ) : (
              <Plus className="h-5 w-5" />
            )}
          </Button>

          {/* Highlights */}
          <Link to="/highlights">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full"
              title="View highlights"
            >
              <Highlighter className="h-5 w-5" />
            </Button>
          </Link>

          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full"
            onClick={handleThemeToggle}
            title={isDarkTheme ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDarkTheme ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>

          {/* Sync (only when authenticated) */}
          {isAuthenticated && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full"
              onClick={handleManualSync}
              disabled={isSyncing}
              title={isSyncing ? "Syncing..." : "Sync library"}
            >
              {isSyncing ? (
                <RefreshCw className="h-5 w-5 animate-spin" />
              ) : navigator.onLine ? (
                <Cloud className="h-5 w-5" />
              ) : (
                <CloudOff className="h-5 w-5 text-muted-foreground" />
              )}
            </Button>
          )}

          {/* User Account */}
          {isAuthLoading ? (
            <div className="h-10 w-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
            </div>
          ) : isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarImage
                      src={user.image || undefined}
                      alt={user.name || "User"}
                    />
                    <AvatarFallback className="text-xs">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" className="w-60">
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
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full"
              title="Sign in with Google"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
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
            </Button>
          )}
        </aside>

        {/* Main Content */}
        <main className="px-4 md:pl-24 md:pr-8 py-8 md:py-12">
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

          {/* Mobile Header Actions */}
          <div className="flex md:hidden items-center justify-between mb-6 px-2">
            <Button
              onClick={handleAddBookClick}
              disabled={isProcessing}
              size="sm"
              variant="ghost"
              className="gap-2"
            >
              {isProcessing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add Book
            </Button>
            <div className="flex items-center gap-1">
              <Link to="/highlights">
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <Highlighter className="h-4 w-4" />
                </Button>
              </Link>
              {/* Theme Toggle */}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={handleThemeToggle}
              >
                {isDarkTheme ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
              {isAuthenticated && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={handleManualSync}
                  disabled={isSyncing}
                >
                  {isSyncing ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Cloud className="h-4 w-4" />
                  )}
                </Button>
              )}
              {isAuthenticated && user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={user.image || undefined} />
                        <AvatarFallback className="text-xs">
                          {getUserInitials()}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium">{user.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/sessions">
                        <Monitor className="mr-2 h-4 w-4" />
                        Sessions
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleSignOut}>
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  onClick={handleGoogleSignIn}
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
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
                </Button>
              )}
            </div>
          </div>

          {/* Books Content */}
          {hasAnyBooks ? (
            <div className="space-y-8 fade-in animate-in duration-300">
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
                        onDelete={handleDeleteBook}
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
                        onDelete={handleDeleteBook}
                        onPrefetch={handlePrefetchBook}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 sm:py-20 md:py-24 lg:py-32 xl:py-40 2xl:py-48 text-center">
              {/* Animated floating books illustration */}
              <div className="relative mb-6 sm:mb-8 md:mb-10 lg:mb-12 xl:mb-14 2xl:mb-16">
                {/* Background glow */}
                <div className="absolute inset-0 bg-primary/5 blur-3xl rounded-full scale-150" />

                {/* Floating book stack */}
                <div className="relative">
                  {/* Back book */}
                  <div
                    className="absolute -left-2 sm:-left-3 md:-left-4 lg:-left-5 xl:-left-6 2xl:-left-8 -top-1.5 sm:-top-2 md:-top-3 lg:-top-4 xl:-top-5 2xl:-top-6 w-12 h-18 sm:w-16 sm:h-24 md:w-20 md:h-30 lg:w-24 lg:h-36 xl:w-28 xl:h-42 2xl:w-36 2xl:h-54 rounded-r-md rounded-l-sm bg-gradient-to-br from-muted to-muted-foreground/20 shadow-lg transform -rotate-12 animate-[float_3s_ease-in-out_infinite]"
                    style={{ animationDelay: "-0.5s" }}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 sm:w-1 md:w-1.5 bg-gradient-to-r from-black/10 to-transparent" />
                  </div>

                  {/* Middle book */}
                  <div
                    className="absolute left-1.5 sm:left-2 md:left-3 lg:left-4 xl:left-5 2xl:left-6 top-0.5 sm:top-1 md:top-1.5 lg:top-2 xl:top-3 2xl:top-4 w-12 h-18 sm:w-16 sm:h-24 md:w-20 md:h-30 lg:w-24 lg:h-36 xl:w-28 xl:h-42 2xl:w-36 2xl:h-54 rounded-r-md rounded-l-sm bg-gradient-to-br from-secondary to-secondary-foreground/10 shadow-lg transform rotate-6 animate-[float_3s_ease-in-out_infinite]"
                    style={{ animationDelay: "-1s" }}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 sm:w-1 md:w-1.5 bg-gradient-to-r from-black/10 to-transparent" />
                  </div>

                  {/* Front book with icon */}
                  <div className="relative w-16 h-22 sm:w-20 sm:h-28 md:w-24 md:h-36 lg:w-32 lg:h-44 xl:w-36 xl:h-52 2xl:w-48 2xl:h-68 rounded-r-md rounded-l-sm bg-gradient-to-br from-primary/10 to-primary/5 shadow-xl ring-1 ring-primary/10 animate-[float_3s_ease-in-out_infinite] flex items-center justify-center">
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
                  onClick={handleAddBookClick}
                  className="gap-2 text-sm sm:text-base md:text-lg lg:text-xl xl:text-2xl h-9 sm:h-10 md:h-12 lg:h-14 xl:h-16 px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10"
                >
                  <Upload className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6 lg:h-7 lg:w-7 xl:h-8 xl:w-8" />
                  Import EPUB
                </Button>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
