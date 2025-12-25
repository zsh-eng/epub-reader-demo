import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFileUrl } from "@/hooks/use-file-url";
import { useReadingStatus } from "@/hooks/use-reading-status";
import { useToast } from "@/hooks/use-toast";
import type { Book, ReadingStatus } from "@/lib/db";
import {
  Book as BookIcon,
  BookMarked,
  BookOpen,
  CheckCircle,
  Loader2,
  MoreVertical,
  Trash2,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";

interface BookCardProps {
  book: Book;
  onDelete: (bookId: string) => void;
}

export function BookCard({ book, onDelete }: BookCardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { status, setStatus, isUpdating } = useReadingStatus(book.id);

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
          title: `Marked as ${statusLabels[newStatus]}`,
        });
      },
    });
  };

  return (
    <div className="group relative flex flex-col gap-3 w-full max-w-[180px] mx-auto">
      {/* Book Cover Container */}
      <div
        onClick={handleClick}
        className="relative aspect-[2/3] w-full cursor-pointer perspective-1000"
      >
        <div className="relative w-full h-full transition-transform duration-300 ease-out group-hover:-translate-y-2 group-hover:scale-[1.02]">
          {/* Book Shadow */}
          <div className="absolute inset-0 rounded-md bg-black/20 blur-md translate-y-2 scale-[0.95] transition-all duration-300 group-hover:translate-y-4 group-hover:blur-lg group-hover:bg-black/30" />

          {/* Main Cover */}
          <div className="relative h-full w-full overflow-hidden rounded-r-md rounded-l-sm bg-white shadow-sm ring-1 ring-black/5">
            {/* Spine Effect */}
            <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-gradient-to-r from-black/20 to-transparent z-10" />
            <div className="absolute left-[4px] top-0 bottom-0 w-[1px] bg-white/30 z-10" />

            {coverUrl ? (
              <img
                src={coverUrl}
                alt={`Cover of ${book.title}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : isLoadingCover ? (
              <div className="flex h-full w-full flex-col items-center justify-center bg-secondary p-4 text-center">
                <Loader2 className="mb-2 h-8 w-8 text-muted-foreground/50 animate-spin" />
                <span className="text-xs font-medium text-muted-foreground line-clamp-3">
                  {book.title}
                </span>
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center bg-secondary p-4 text-center">
                <BookIcon className="mb-2 h-8 w-8 text-muted-foreground/50" />
                <span className="text-xs font-medium text-muted-foreground line-clamp-3">
                  {book.title}
                </span>
              </div>
            )}

            {/* Glossy Overlay */}
            <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/0 to-white/10 pointer-events-none" />
          </div>
        </div>

        {/* Action Menu */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 rounded-full backdrop-blur-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  className="cursor-pointer"
                  disabled={isUpdating}
                >
                  <BookMarked className="mr-2 h-4 w-4" />
                  Set Status
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => handleSetStatus("reading")}
                  >
                    <BookOpen className="mr-2 h-4 w-4" />
                    Reading
                    {status === "reading" && (
                      <CheckCircle className="ml-auto h-4 w-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => handleSetStatus("finished")}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Finished
                    {status === "finished" && (
                      <CheckCircle className="ml-auto h-4 w-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => handleSetStatus("dnf")}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Did Not Finish
                    {status === "dnf" && (
                      <CheckCircle className="ml-auto h-4 w-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive"
                onClick={handleDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove Book
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
  );
}
