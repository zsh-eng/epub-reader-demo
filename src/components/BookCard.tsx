import { BookCardActions } from "@/components/BookCardActions";
import { READING_STATUS_LABELS } from "@/components/BookStatusSheet";
import { useSetReadingStatus } from "@/hooks/use-reading-status";
import { useToast } from "@/hooks/use-toast";
import type { Book, ReadingStatus } from "@/lib/db";
import { Book as BookIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface BookCardProps {
  book: Book;
  status: ReadingStatus | null;
  coverUrl?: string;
  onDelete: (bookId: string) => void;
  onCoverRequest?: (book: Book) => void;
  onPrefetch?: (book: Book) => void;
  onOpenMobileActions?: () => void;
}

function formatOpenedDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Extracted visual component for the book cover (used in both normal and preview state)
function BookCoverVisual({
  coverUrl,
  title,
}: {
  coverUrl: string | undefined;
  title: string;
}) {
  return (
    <div className="relative w-full h-full">
      {/* Book Shadow */}
      <div className="absolute inset-0 rounded-md bg-black/20 blur-md translate-y-2 scale-[0.95]" />

      {/* Main Cover */}
      <div className="relative h-full w-full overflow-hidden rounded-r-md rounded-l-sm bg-white shadow-sm">
        {/* Spine Effect */}
        <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-gradient-to-r from-black/20 to-transparent z-10" />
        <div className="absolute left-[4px] top-0 bottom-0 w-[1px] bg-white/30 z-10" />

        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`Cover of ${title}`}
            draggable={false}
            className="pointer-events-none absolute inset-0 block h-full w-full select-none object-cover"
            loading="eager"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-secondary p-4 text-center">
            <BookIcon className="mb-2 h-8 w-8 text-muted-foreground/50" />
            <span className="text-xs font-medium text-muted-foreground line-clamp-3">
              {title}
            </span>
          </div>
        )}

        {/* Glossy Overlay */}
        <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/0 to-white/10 pointer-events-none" />
      </div>
    </div>
  );
}

export function BookCard({
  book,
  status,
  coverUrl,
  onDelete,
  onCoverRequest,
  onPrefetch,
  onOpenMobileActions,
}: BookCardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const setStatus = useSetReadingStatus(book.id);
  const [cardElement, setCardElement] = useState<HTMLDivElement | null>(null);
  const [displayStatus, setDisplayStatus] = useState(status);

  useEffect(() => {
    setDisplayStatus(status);
  }, [status]);

  useEffect(() => {
    if (coverUrl || !book.coverContentHash || !onCoverRequest) return;
    if (!cardElement) return;

    if (typeof IntersectionObserver === "undefined") {
      onCoverRequest(book);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        onCoverRequest(book);
        observer.disconnect();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(cardElement);

    return () => {
      observer.disconnect();
    };
  }, [book, cardElement, coverUrl, onCoverRequest]);

  const handleClick = () => {
    // Navigate to reader - the reader will handle downloading/processing if needed
    navigate(`/reader/${book.id}`);
  };

  const handlePrefetch = () => {
    onPrefetch?.(book);
  };

  const handleDelete = (): boolean => {
    const shouldDelete = window.confirm(
      `Are you sure you want to remove "${book.title}" from your library?`,
    );
    if (!shouldDelete) return false;

    onDelete(book.id);
    return true;
  };

  const handleSetStatus = (newStatus: ReadingStatus) => {
    if (newStatus === displayStatus || setStatus.isPending) return;

    const previousStatus = displayStatus;
    setDisplayStatus(newStatus);

    setStatus.mutate(newStatus, {
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

  return (
    <BookCardActions
      status={displayStatus}
      isUpdating={setStatus.isPending}
      onSelectStatus={handleSetStatus}
      onRemove={handleDelete}
      onOpenMobileActions={() => onOpenMobileActions?.()}
    >
      <div
        ref={setCardElement}
        className="group relative flex w-full flex-col gap-3"
        onFocusCapture={handlePrefetch}
        onPointerDown={handlePrefetch}
        onPointerEnter={handlePrefetch}
      >
        {/* Book Cover Container */}
        <div
          onClick={handleClick}
          className="relative aspect-[2/3] w-full cursor-pointer perspective-1000"
        >
          <div className="relative h-full w-full transition-transform duration-300 ease-out group-hover:-translate-y-2 group-hover:scale-[1.02]">
            <BookCoverVisual coverUrl={coverUrl} title={book.title} />
          </div>
        </div>

        {/* Book Info */}
        <div className="space-y-1 px-1 text-center">
          <h3
            onClick={handleClick}
            className="line-clamp-2 cursor-pointer text-sm leading-tight font-medium text-foreground transition-colors hover:text-primary"
            title={book.title}
          >
            {book.title}
          </h3>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {book.author}
          </p>
          {book.lastOpened && (
            <p className="text-[10px] tracking-wider text-muted-foreground/60 uppercase">
              Opened {formatOpenedDate(book.lastOpened)}
            </p>
          )}
        </div>
      </div>
    </BookCardActions>
  );
}
