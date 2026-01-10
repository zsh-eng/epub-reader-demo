import {
  ResponsiveContextMenu,
  ResponsiveContextMenuContent,
  ResponsiveContextMenuItem,
  ResponsiveContextMenuSeparator,
  ResponsiveContextMenuTrigger,
} from "@/components/ui/responsive-context-menu";
import { useFileUrl } from "@/hooks/use-file-url";
import { useReadingStatus } from "@/hooks/use-reading-status";
import { useToast } from "@/hooks/use-toast";
import type { Book, ReadingStatus } from "@/lib/db";
import {
  Book as BookIcon,
  BookOpen,
  CheckCircle,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface BookCardProps {
  book: Book;
  onDelete: (bookId: string) => void;
}

// Extracted visual component for the book cover (used in both normal and preview state)
function BookCoverVisual({
  coverUrl,
  isLoadingCover,
  title,
}: {
  coverUrl: string | null | undefined;
  isLoadingCover: boolean;
  title: string;
}) {
  return (
    <div className="relative w-full h-full">
      {/* Book Shadow */}
      <div className="absolute inset-0 rounded-md bg-black/20 blur-md translate-y-2 scale-[0.95]" />

      {/* Main Cover */}
      <div className="relative h-full w-full overflow-hidden rounded-r-md rounded-l-sm bg-white shadow-sm ring-1 ring-black/5">
        {/* Spine Effect */}
        <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-gradient-to-r from-black/20 to-transparent z-10" />
        <div className="absolute left-[4px] top-0 bottom-0 w-[1px] bg-white/30 z-10" />

        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`Cover of ${title}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : isLoadingCover ? (
          <div className="flex h-full w-full flex-col items-center justify-center bg-secondary p-4 text-center">
            <Loader2 className="mb-2 h-8 w-8 text-muted-foreground/50 animate-spin" />
            <span className="text-xs font-medium text-muted-foreground line-clamp-3">
              {title}
            </span>
          </div>
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

export function BookCard({ book, onDelete }: BookCardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { status, setStatus } = useReadingStatus(book.id);

  // Use FileManager to get cover URL from content hash
  const { url: coverUrl, isLoading: isLoadingCover } = useFileUrl(
    book.coverContentHash,
    "cover",
    { skip: !book.coverContentHash },
  );

  const handleClick = () => {
    // Navigate to reader - the reader will handle downloading/processing if needed
    navigate(`/reader/${book.id}`);
  };

  const handleDelete = () => {
    if (
      window.confirm(
        `Are you sure you want to remove "${book.title}" from your library?`,
      )
    ) {
      onDelete(book.id);
    }
  };

  const handleSetStatus = (newStatus: ReadingStatus) => {
    setStatus(newStatus, {
      onSuccess: () => {
        const statusLabels: Record<ReadingStatus, string> = {
          "want-to-read": "Want to Read",
          reading: "Reading",
          finished: "Finished",
          dnf: "Did Not Finish",
        };
        toast({
          title: `Marked ${book.title} as ${statusLabels[newStatus]}`,
        });
      },
    });
  };

  return (
    <ResponsiveContextMenu>
      <ResponsiveContextMenuTrigger>
        <div className="group relative flex flex-col gap-3 w-full">
          {/* Book Cover Container */}
          <div
            onClick={handleClick}
            className="relative aspect-[2/3] w-full cursor-pointer perspective-1000"
          >
            <div className="relative w-full h-full transition-transform duration-300 ease-out group-hover:-translate-y-2 group-hover:scale-[1.02]">
              <BookCoverVisual
                coverUrl={coverUrl}
                isLoadingCover={isLoadingCover}
                title={book.title}
              />
            </div>
          </div>

          {/* Book Info */}
          <div className="space-y-1 text-center px-1">
            <h3
              onClick={handleClick}
              className="font-medium text-sm leading-tight text-foreground line-clamp-2 cursor-pointer hover:text-primary transition-colors"
              title={book.title}
            >
              {book.title}
            </h3>
            <p className="text-xs text-muted-foreground line-clamp-1">
              {book.author}
            </p>
            {book.lastOpened && (
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                {Math.round(Math.random() * 100)}% Read
              </p>
            )}
          </div>
        </div>
      </ResponsiveContextMenuTrigger>

      {/* Context Menu Content */}
      <ResponsiveContextMenuContent>
        <ResponsiveContextMenuItem
          icon={<BookOpen className="h-4 w-4" />}
          onClick={() => handleSetStatus("reading")}
        >
          Reading
          {status === "reading" && (
            <CheckCircle className="ml-auto h-4 w-4 text-primary" />
          )}
        </ResponsiveContextMenuItem>
        <ResponsiveContextMenuItem
          icon={<CheckCircle className="h-4 w-4" />}
          onClick={() => handleSetStatus("finished")}
        >
          Finished
          {status === "finished" && (
            <CheckCircle className="ml-auto h-4 w-4 text-primary" />
          )}
        </ResponsiveContextMenuItem>
        <ResponsiveContextMenuItem
          icon={<XCircle className="h-4 w-4" />}
          onClick={() => handleSetStatus("dnf")}
        >
          Did Not Finish
          {status === "dnf" && (
            <CheckCircle className="ml-auto h-4 w-4 text-primary" />
          )}
        </ResponsiveContextMenuItem>
        <ResponsiveContextMenuSeparator />
        <ResponsiveContextMenuItem
          icon={<Trash2 className="h-4 w-4" />}
          destructive
          onClick={handleDelete}
        >
          Remove Book
        </ResponsiveContextMenuItem>
      </ResponsiveContextMenuContent>
    </ResponsiveContextMenu>
  );
}
