import { useSpringPressAnimation } from "@/components/ui/spring-press";
import { cn } from "@/lib/utils";
import { BookOpenText } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";

const MotionLink = motion.create(Link);

interface ContinueReadingCardProps {
  bookId: string;
  bookTitle: string;
  coverUrl: string | undefined;
  activityLabel: string;
  isActive?: boolean;
  appearance?: "panel" | "open";
  className?: string;
}

interface CircularBookCoverProps {
  coverUrl: string | undefined;
  className?: string;
}

/** Shared circular treatment for book-focused mobile surfaces. */
export function CircularBookCover({
  coverUrl,
  className,
}: CircularBookCoverProps) {
  return (
    <span
      className={cn(
        "relative flex size-24 items-center justify-center overflow-hidden rounded-full border-[5px] border-background bg-secondary shadow-sm ring-1 ring-border/70",
        className,
      )}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          aria-hidden="true"
          className="size-full object-cover"
        />
      ) : (
        <BookOpenText
          className="size-7 text-muted-foreground/60"
          aria-hidden="true"
        />
      )}
    </span>
  );
}

/** Circular resume card shared by mobile navigation and Sessions. */
export function ContinueReadingCard({
  bookId,
  bookTitle,
  coverUrl,
  activityLabel,
  isActive = false,
  appearance = "panel",
  className,
}: ContinueReadingCardProps) {
  const springPress = useSpringPressAnimation();
  const isOpen = appearance === "open";

  return (
    <MotionLink
      to={`/reader/${bookId}`}
      aria-label={`Continue reading ${bookTitle}`}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative block overflow-hidden text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        isOpen
          ? "px-2 py-5"
          : "rounded-[1.5rem] border border-border/60 bg-secondary/35 px-4 pb-4 pt-3 transition-[background-color,border-color] hover:bg-secondary/55",
        className,
      )}
      {...springPress}
    >
      <span
        className={cn(
          "pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl",
          isOpen ? "top-5 size-56" : "top-8 size-36",
        )}
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute inset-x-8 bottom-0 h-16 rounded-full bg-secondary/80 blur-2xl"
        aria-hidden="true"
      />

      <span className="relative z-10 block text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Continue reading
      </span>

      <span
        className={cn(
          "relative z-10 flex justify-center",
          isOpen ? "my-5" : "my-3",
        )}
      >
        <CircularBookCover
          coverUrl={coverUrl}
          className={isOpen ? "size-32 sm:size-36" : undefined}
        />
      </span>

      <span
        className={cn(
          "relative z-10 block truncate font-serif font-medium tracking-[-0.01em] text-foreground",
          isOpen ? "text-xl sm:text-2xl" : "text-base",
        )}
      >
        {bookTitle}
      </span>
      <span className="relative z-10 mt-1 block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {activityLabel}
      </span>
    </MotionLink>
  );
}
