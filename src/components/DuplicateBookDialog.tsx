import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFileUrl } from "@/hooks/use-file-url";
import type { Book } from "@/lib/db";
import { getBookCoverUrl } from "@/lib/db";
import { Loader2 } from "lucide-react";
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
  const navigate = useNavigate();

  // For remote covers (synced from server), use FileManager
  const { url: remoteCoverUrl, isLoading: isLoadingRemoteCover } = useFileUrl(
    existingBook.hasRemoteCover ? existingBook.fileHash : undefined,
    "cover",
    { skip: !open || !existingBook.hasRemoteCover },
  );

  // For local covers (extracted from EPUB), use bookFiles
  const [localCoverUrl, setLocalCoverUrl] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    // Only load from bookFiles if we don't have a remote cover and book is downloaded
    if (
      !open ||
      existingBook.hasRemoteCover ||
      !existingBook.coverImagePath ||
      !existingBook.isDownloaded
    ) {
      return;
    }

    let objectUrl: string | undefined;

    async function loadLocalCover() {
      try {
        const url = await getBookCoverUrl(
          existingBook.id,
          existingBook.coverImagePath!,
        );
        objectUrl = url;
        setLocalCoverUrl(url);
      } catch (error) {
        console.error("Failed to load local cover:", error);
      }
    }

    loadLocalCover();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [
    open,
    existingBook.id,
    existingBook.coverImagePath,
    existingBook.isDownloaded,
    existingBook.hasRemoteCover,
  ]);

  // Determine which cover URL to use
  const coverUrl = remoteCoverUrl || localCoverUrl;
  const isLoadingCover = existingBook.hasRemoteCover && isLoadingRemoteCover;

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
          {coverUrl ? (
            <div className="flex-shrink-0">
              <img
                src={coverUrl}
                alt={existingBook.title}
                className="h-24 rounded-md shadow-md"
              />
            </div>
          ) : isLoadingCover ? (
            <div className="flex-shrink-0 h-24 w-16 flex items-center justify-center bg-secondary rounded-md">
              <Loader2 className="h-6 w-6 text-muted-foreground/50 animate-spin" />
            </div>
          ) : null}

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
