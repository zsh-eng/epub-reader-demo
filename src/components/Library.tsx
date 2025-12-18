import { BookCard } from "@/components/BookCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { authClient } from "@/lib/auth-client";
import {
  addBookFromFile,
  getLibraryBooks,
  removeBook,
} from "@/lib/book-service";
import type { Book } from "@/lib/db";
import {
  Library as LibraryIcon,
  LogOut,
  Monitor,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

export function Library() {
  const [books, setBooks] = useState<Book[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();

  // Handle Google Sign In
  const handleGoogleSignIn = async () => {
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
      });
    } catch (error) {
      console.error("Error signing in:", error);
      toast({
        title: "Error",
        description: "Failed to sign in with Google",
        variant: "destructive",
      });
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

  // Load books from database
  const loadBooks = useCallback(async () => {
    try {
      const allBooks = await getLibraryBooks();
      setBooks(allBooks);
    } catch (error) {
      console.error("Error loading books:", error);
      toast({
        title: "Error",
        description: "Failed to load books from library",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  // Handle file selection
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsProcessing(true);

    try {
      const file = files[0];
      const book = await addBookFromFile(file);

      toast({
        title: "Success",
        description: `"${book.title}" has been added to your library`,
      });

      // Reload books
      await loadBooks();
    } catch (error) {
      console.error("Error adding book:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to add book",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
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

  // Handle book deletion
  const handleDeleteBook = async (bookId: string) => {
    try {
      await removeBook(bookId);
      toast({
        title: "Success",
        description: "Book removed from library",
      });
      await loadBooks();
    } catch (error) {
      console.error("Error deleting book:", error);
      toast({
        title: "Error",
        description: "Failed to remove book",
        variant: "destructive",
      });
    }
  };

  // Handle file input button click
  const handleAddBookClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".epub";
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      handleFileSelect(target.files);
    };
    input.click();
  };

  const filteredBooks = books.filter(
    (book) =>
      book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      book.author.toLowerCase().includes(searchQuery.toLowerCase()),
  );

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
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-2">
              Library
            </h1>
            <p className="text-muted-foreground text-lg">
              {books.length} {books.length === 1 ? "book" : "books"}
            </p>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search books..."
                className="pl-9 bg-secondary/50 border-transparent focus:bg-background transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button
              onClick={handleAddBookClick}
              disabled={isProcessing}
              className="gap-2 shadow-lg hover:shadow-xl transition-all active:scale-95"
            >
              {isProcessing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Add Book</span>
            </Button>

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
                    className="relative h-8 w-8 rounded-full"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage
                        src={user.image || undefined}
                        alt={user.name || "User"}
                      />
                      <AvatarFallback>{getUserInitials()}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-8 gap-y-12 fade-in animate-in duration-300">
            {filteredBooks.map((book) => (
              <BookCard key={book.id} book={book} onDelete={handleDeleteBook} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="bg-secondary/50 p-6 rounded-full mb-6">
              <LibraryIcon className="h-12 w-12 text-muted-foreground/50" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">
              {searchQuery ? "No books found" : "Your library is empty"}
            </h3>
            <p className="text-muted-foreground max-w-sm mx-auto mb-8">
              {searchQuery
                ? `No results for "${searchQuery}"`
                : "Drag and drop an EPUB file here, or click the button above to add your first book."}
            </p>
            {!searchQuery && (
              <Button
                onClick={handleAddBookClick}
                variant="outline"
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
  );
}
