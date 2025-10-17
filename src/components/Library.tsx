import { useState, useEffect, useCallback } from "react";
import {
  addBookFromFile,
  getLibraryBooks,
  removeBook,
} from "@/lib/book-service";
import type { Book } from "@/lib/db";
import { BookCard } from "@/components/BookCard";
import { Button } from "@/components/ui/button";
import { Plus, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function Library() {
  const [books, setBooks] = useState<Book[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

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
  }, []);

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading library...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">My Library</h1>
          <p className="text-gray-600">
            {books.length === 0
              ? "Start building your library by adding EPUB books"
              : `${books.length} book${books.length !== 1 ? "s" : ""} in your library`}
          </p>
        </div>

        {/* Add Book Button */}
        <div className="mb-6">
          <Button
            onClick={handleAddBookClick}
            disabled={isProcessing}
            size="lg"
            className="gap-2"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Processing...
              </>
            ) : (
              <>
                <Plus className="h-5 w-5" />
                Add Book
              </>
            )}
          </Button>
        </div>

        {/* Drop Zone */}
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`
            border-2 border-dashed rounded-lg p-8 mb-8 transition-colors
            ${
              isDragging
                ? "border-blue-500 bg-blue-50"
                : "border-gray-300 bg-white hover:border-gray-400"
            }
          `}
        >
          <div className="flex flex-col items-center justify-center text-center">
            <Upload
              className={`h-12 w-12 mb-4 ${isDragging ? "text-blue-500" : "text-gray-400"}`}
            />
            <p
              className={`text-lg font-medium mb-2 ${isDragging ? "text-blue-700" : "text-gray-700"}`}
            >
              {isDragging
                ? "Drop EPUB file here"
                : "Drag and drop EPUB files here"}
            </p>
            <p className="text-sm text-gray-500">
              or click the "Add Book" button above
            </p>
          </div>
        </div>

        {/* Books Grid */}
        {books.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {books.map((book) => (
              <BookCard key={book.id} book={book} onDelete={handleDeleteBook} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-4">
              <svg
                className="mx-auto h-24 w-24"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No books yet
            </h3>
            <p className="text-gray-500">
              Add your first EPUB book to get started
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
