import { CircularBookCover } from "@/components/ContinueReadingCard";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useSpringPressAnimation } from "@/components/ui/spring-press";
import type { ReadingStatus } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  BookMarked,
  BookOpen,
  Check,
  CheckCircle,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";

export interface ReadingStatusOption {
  value: ReadingStatus;
  label: string;
  icon: LucideIcon;
}

export const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  "want-to-read": "Want to Read",
  reading: "Reading",
  finished: "Finished",
  dnf: "Did Not Finish",
};

export const READING_STATUS_OPTIONS: ReadingStatusOption[] = [
  {
    value: "want-to-read",
    label: READING_STATUS_LABELS["want-to-read"],
    icon: BookMarked,
  },
  { value: "reading", label: READING_STATUS_LABELS.reading, icon: BookOpen },
  {
    value: "finished",
    label: READING_STATUS_LABELS.finished,
    icon: CheckCircle,
  },
  { value: "dnf", label: READING_STATUS_LABELS.dnf, icon: XCircle },
];

interface BookStatusSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookTitle: string;
  bookAuthor: string;
  coverUrl: string | undefined;
  status: ReadingStatus | null;
  isUpdating: boolean;
  onOpenBook: () => void;
  onSelectStatus: (status: ReadingStatus) => void;
  onRemove: () => boolean;
}

function BookStatusOptionButton({
  option,
  isSelected,
  isUpdating,
  onSelect,
}: {
  option: ReadingStatusOption;
  isSelected: boolean;
  isUpdating: boolean;
  onSelect: () => void;
}) {
  const springPress = useSpringPressAnimation();

  return (
    <motion.button
      type="button"
      aria-pressed={isSelected}
      disabled={isUpdating}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-[1.25rem] border bg-secondary/35 px-4 py-3 text-left outline-none transition-[background-color,border-color] focus-visible:ring-2 focus-visible:ring-ring/60",
        isSelected
          ? "border-foreground bg-secondary/65"
          : "border-border/60 hover:bg-secondary/55",
        isUpdating && "cursor-wait opacity-70",
      )}
      onClick={onSelect}
      {...springPress}
    >
      <option.icon
        className={cn(
          "size-5 shrink-0",
          isSelected ? "text-foreground" : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 text-[15px] font-medium text-foreground">
        {option.label}
      </span>
      {isSelected && (
        <Check className="size-5 shrink-0 text-foreground" aria-hidden="true" />
      )}
    </motion.button>
  );
}

/** Mobile book actions with persistent, directly visible reading statuses. */
export function BookStatusSheet({
  open,
  onOpenChange,
  bookTitle,
  bookAuthor,
  coverUrl,
  status,
  isUpdating,
  onOpenBook,
  onSelectStatus,
  onRemove,
}: BookStatusSheetProps) {
  const removePress = useSpringPressAnimation();

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reading status"
      showHeader={false}
      panelClassName="max-w-md"
      bodyClassName="overflow-y-auto"
    >
      <div
        className="px-4 pt-3"
        style={{
          paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
        }}
      >
        <button
          type="button"
          aria-label={`Open ${bookTitle}`}
          onClick={onOpenBook}
          className="mb-5 flex w-full min-w-0 items-center gap-4 rounded-[1.25rem] px-2 py-1 text-left outline-none transition-[background-color,opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-secondary/35 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:active:scale-100 motion-reduce:active:opacity-80"
        >
          <CircularBookCover coverUrl={coverUrl} className="size-20 shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-serif text-xl font-medium tracking-[-0.01em] text-foreground">
              {bookTitle}
            </p>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {bookAuthor}
            </p>
          </div>
        </button>

        <div className="flex flex-col gap-2">
          {READING_STATUS_OPTIONS.map((option) => {
            const isSelected = status === option.value;

            return (
              <BookStatusOptionButton
                key={option.value}
                option={option}
                isSelected={isSelected}
                isUpdating={isUpdating}
                onSelect={() => onSelectStatus(option.value)}
              />
            );
          })}
        </div>

        <motion.button
          type="button"
          className="mt-6 flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[1.1rem] border border-destructive/40 bg-destructive/5 px-4 py-3 text-center text-sm font-medium text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring/60"
          onClick={() => {
            if (onRemove()) onOpenChange(false);
          }}
          {...removePress}
        >
          <Trash2 className="size-5" aria-hidden="true" />
          Remove Book
        </motion.button>
      </div>
    </BottomSheet>
  );
}
