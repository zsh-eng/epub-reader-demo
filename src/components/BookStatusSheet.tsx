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

export const READING_STATUS_OPTIONS: ReadingStatusOption[] = [
  { value: "want-to-read", label: "Want to Read", icon: BookMarked },
  { value: "reading", label: "Reading", icon: BookOpen },
  { value: "finished", label: "Finished", icon: CheckCircle },
  { value: "dnf", label: "Did Not Finish", icon: XCircle },
];

interface BookStatusSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookTitle: string;
  bookAuthor: string;
  coverUrl: string | undefined;
  status: ReadingStatus | null;
  isUpdating: boolean;
  onSelectStatus: (status: ReadingStatus) => void;
  onRemove: () => boolean;
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
  onSelectStatus,
  onRemove,
}: BookStatusSheetProps) {
  const springPress = useSpringPressAnimation();

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reading status"
      panelClassName="max-w-md"
      bodyClassName="overflow-y-auto"
      disableBodyDrag
    >
      <div
        className="px-4 pt-3"
        style={{
          paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
        }}
      >
        <motion.div
          className="mb-5 flex min-w-0 items-center gap-4 px-2"
          initial={{ opacity: 0, transform: "translateY(12px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
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
        </motion.div>

        <div className="flex flex-col gap-2">
          {READING_STATUS_OPTIONS.map((option, index) => {
            const isSelected = status === option.value;

            return (
              <motion.div
                key={option.value}
                initial={{ opacity: 0, transform: "translateY(16px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                transition={{
                  duration: 0.2,
                  ease: [0.16, 1, 0.3, 1],
                  delay: 0.03 + index * 0.05,
                }}
              >
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
                  onClick={() => onSelectStatus(option.value)}
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
                    <Check
                      className="size-5 shrink-0 text-foreground"
                      aria-hidden="true"
                    />
                  )}
                </motion.button>
              </motion.div>
            );
          })}
        </div>

        <motion.button
          type="button"
          className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-[1.1rem] px-4 py-3 text-left text-sm font-medium text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring/60"
          onClick={() => {
            if (onRemove()) onOpenChange(false);
          }}
          {...springPress}
        >
          <Trash2 className="size-5" aria-hidden="true" />
          Remove Book
        </motion.button>
      </div>
    </BottomSheet>
  );
}
