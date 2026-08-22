import {
  BookStatusSheet,
  READING_STATUS_LABELS,
} from "@/components/BookStatusSheet";
import { useSetReadingStatus } from "@/hooks/use-reading-status";
import { useToast } from "@/hooks/use-toast";
import type { ReadingStatus, SyncedBook } from "@/lib/db";
import { useState } from "react";

interface LibraryBookStatusSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  book: SyncedBook;
  coverUrl: string | undefined;
  initialStatus: ReadingStatus | null;
  onOpenBook: (bookId: string) => void;
  onDelete: (bookId: string) => void;
}

/**
 * Owns mobile status state outside the library grids. A query invalidation can
 * move the book between sections without unmounting or resetting this sheet.
 */
export function LibraryBookStatusSheet({
  open,
  onOpenChange,
  book,
  coverUrl,
  initialStatus,
  onOpenBook,
  onDelete,
}: LibraryBookStatusSheetProps) {
  const { toast } = useToast();
  const setReadingStatus = useSetReadingStatus(book.id);
  const [displayStatus, setDisplayStatus] = useState(initialStatus);

  const handleSetStatus = (newStatus: ReadingStatus) => {
    if (newStatus === displayStatus || setReadingStatus.isPending) return;

    const previousStatus = displayStatus;
    setDisplayStatus(newStatus);
    setReadingStatus.mutate(newStatus, {
      onSuccess: () => {
        toast({
          title: `Marked ${book.title} as ${READING_STATUS_LABELS[newStatus]}`,
        });
      },
      onError: () => {
        setDisplayStatus(previousStatus);
        toast({
          title: "Could not update reading status",
          description: "Please try again.",
          variant: "destructive",
        });
      },
    });
  };

  const handleRemove = (): boolean => {
    const shouldDelete = window.confirm(
      `Are you sure you want to remove "${book.title}" from your library?`,
    );
    if (!shouldDelete) return false;

    onDelete(book.id);
    return true;
  };

  return (
    <BookStatusSheet
      open={open}
      onOpenChange={onOpenChange}
      bookTitle={book.title}
      bookAuthor={book.author}
      coverUrl={coverUrl}
      status={displayStatus}
      isUpdating={setReadingStatus.isPending}
      onOpenBook={() => {
        onOpenChange(false);
        onOpenBook(book.id);
      }}
      onSelectStatus={handleSetStatus}
      onRemove={handleRemove}
    />
  );
}
