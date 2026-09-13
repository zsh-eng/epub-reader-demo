import { ReadingStatusChangeMessage } from "@/components/ReadingStatusChangeMessage";
import { BookStatusSheet } from "@/components/BookStatusSheet";
import { useFileUrl } from "@/hooks/use-file-url";
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
  const { url: coverUrl } = useFileUrl(book.cover?.fileId, { skip: !isOpen });
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
          message: (
            <ReadingStatusChangeMessage
              previousStatus={previousStatus}
              status={nextStatus}
            />
          ),
        });
      })
      .catch(() => {
        setDisplayStatus(previousStatus);
        toast({
          message: "Could not change reading status.",
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
          message: "Removed book from library.",
        });
        navigate("/");
      })
      .catch(() => {
        toast({
          message: "Could not remove book.",
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
      coverUrl={coverUrl}
      status={displayStatus}
      isUpdating={isLoading || isUpdating}
      onBack={onBack}
      onSelectStatus={handleSelectStatus}
      onRemove={handleRemove}
    />
  );
}
