import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Book } from "@/lib/db";
import { getBookCoverUrl } from "@/lib/db";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface DuplicateBookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingBook: Book;
}

export function DuplicateBookDialog({
  open,
  onOpenChange,
  existingBook,
}: DuplicateBookDialogProps) {
  const [coverUrl, setCoverUrl] = useState<string | undefined>();
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    if (open && existingBook.coverImagePath) {
      getBookCoverUrl(existingBook.id, existingBook.coverImagePath).then(
        (url) => {
          if (isMounted && url) {
            setCoverUrl(url);
          }
        },
      );
    }

    return () => {
      isMounted = false;
      if (coverUrl) {
        URL.revokeObjectURL(coverUrl);
      }
    };
  }, [open, existingBook.id, existingBook.coverImagePath, coverUrl]);

  const handleOpenBook = () => {
    onOpenChange(false);
    navigate(`/reader/${existingBook.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold tracking-tight text-foreground">
            Duplicate Found
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            This book is already in your library.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 py-4">
          {coverUrl && (
            <div className="flex-shrink-0">
              <img
                src={coverUrl}
                alt={existingBook.title}
                className="h-24 rounded-md shadow-md"
              />
            </div>
          )}

          <div className="flex flex-col justify-center min-w-0">
            <h3 className="font-semibold text-lg line-clamp-2">
              {existingBook.title}
            </h3>
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
              {existingBook.author}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Added{" "}
              {new Date(existingBook.dateAdded).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            Close
          </Button>
          <Button onClick={handleOpenBook} className="rounded-xl">
            Open Book
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
