import {
  BookStatusSheet,
  READING_STATUS_LABELS,
} from "@/components/BookStatusSheet";
import { useReadingStatus } from "@/hooks/use-reading-status";
import { useSync } from "@/hooks/use-sync";
import { useToast } from "@/hooks/use-toast";
import type { Book, ReadingStatus } from "@/lib/db";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface ReaderBookActionsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onBack: () => void;
  book: Book;
}

/** Keeps the full book-status sheet available from the mobile reader tools. */
export function ReaderBookActionsSheet({
  isOpen,
  onClose,
  onBack,
  book,
}: ReaderBookActionsSheetProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { deleteBook } = useSync();
  const { status, isLoading, setStatusAsync, isUpdating } = useReadingStatus(
    book.id,
  );
  const [displayStatus, setDisplayStatus] = useState<ReadingStatus | null>(
    status,
  );

  useEffect(() => {
    if (isLoading) return;
    setDisplayStatus(status);
  }, [isLoading, status]);

  const handleSelectStatus = (nextStatus: ReadingStatus) => {
    if (nextStatus === displayStatus || isUpdating) return;

    const previousStatus = displayStatus;
    setDisplayStatus(nextStatus);
    void setStatusAsync(nextStatus)
      .then(() => {
        toast({
          title: `Marked ${book.title} as ${READING_STATUS_LABELS[nextStatus]}`,
        });
      })
      .catch(() => {
        setDisplayStatus(previousStatus);
        toast({
          title: "Could not update reading status",
          description: "Please try again.",
          variant: "destructive",
        });
      });
  };

  const handleRemove = (): boolean => {
    const shouldDelete = window.confirm(
      `Are you sure you want to remove "${book.title}" from your library?`,
    );
    if (!shouldDelete) return false;

    void deleteBook(book.id)
      .then(() => {
        toast({
          title: "Success",
          description: "Book removed from library",
        });
        navigate("/");
      })
      .catch(() => {
        toast({
          title: "Error",
          description: "Failed to remove book",
          variant: "destructive",
        });
      });
    return true;
  };

  return (
    <BookStatusSheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      bookTitle={book.title}
      bookAuthor={book.author}
      coverUrl={undefined}
      status={displayStatus}
      isUpdating={isLoading || isUpdating}
      onBack={onBack}
      onSelectStatus={handleSelectStatus}
      onRemove={handleRemove}
    />
  );
}
