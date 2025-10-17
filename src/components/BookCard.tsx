import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import type { Book } from "@/lib/db";
import { getBookCoverUrl } from "@/lib/db";
import { Trash2, Book as BookIcon } from "lucide-react";
import { Button } from "./ui/button";

interface BookCardProps {
  book: Book;
  onDelete: (bookId: string) => void;
}

export function BookCard({ book, onDelete }: BookCardProps) {
  const navigate = useNavigate();
  const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let objectUrl: string | undefined;

    async function loadCover() {
      if (book.coverImagePath) {
        const url = await getBookCoverUrl(book.id, book.coverImagePath);
        objectUrl = url;
        setCoverUrl(url);
      }
    }

    loadCover();

    // Cleanup: revoke the blob URL when component unmounts
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [book.id, book.coverImagePath]);

  const handleClick = () => {
    navigate(`/reader/${book.id}`);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      window.confirm(
        `Are you sure you want to remove "${book.title}" from your library?`,
      )
    ) {
      onDelete(book.id);
    }
  };

  return (
    <div className="group relative">
      <div
        onClick={handleClick}
        className="cursor-pointer flex flex-col bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden"
      >
        {/* Cover Image */}
        <div className="aspect-[2/3] bg-gray-200 relative overflow-hidden">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={`Cover of ${book.title}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-300 to-gray-400">
              <BookIcon className="w-12 h-12 text-gray-500" />
            </div>
          )}

          {/* Delete Button - shown on hover */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="destructive"
              size="icon"
              className="h-8 w-8 rounded-full shadow-lg"
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Book Info */}
        <div className="p-3">
          <h3 className="font-semibold text-sm line-clamp-2 mb-1 text-gray-900">
            {book.title}
          </h3>
          <p className="text-xs text-gray-600 line-clamp-1">{book.author}</p>
          {book.lastOpened && (
            <p className="text-xs text-gray-400 mt-1">
              Last read: {new Date(book.lastOpened).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
