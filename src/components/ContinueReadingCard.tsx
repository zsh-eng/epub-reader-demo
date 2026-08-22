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
  className?: string;
}

/** Circular resume card shared by the mobile launcher and Sessions. */
export function ContinueReadingCard({
  bookId,
  bookTitle,
  coverUrl,
  activityLabel,
  isActive = false,
  className,
}: ContinueReadingCardProps) {
  const springPress = useSpringPressAnimation();

  return (
    <MotionLink
      to={`/reader/${bookId}`}
      aria-label={`Continue reading ${bookTitle}`}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative block overflow-hidden rounded-[1.5rem] border border-border/60 bg-secondary/35 px-4 pb-4 pt-3 text-center outline-none transition-[background-color,border-color] hover:bg-secondary/55 focus-visible:ring-2 focus-visible:ring-ring/60",
        className,
      )}
      {...springPress}
    >
      <span
        className="pointer-events-none absolute left-1/2 top-8 size-36 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute inset-x-8 bottom-0 h-16 rounded-full bg-secondary/80 blur-2xl"
        aria-hidden="true"
      />

      <span className="relative z-10 block text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Continue reading
      </span>

      <span className="relative z-10 my-3 flex justify-center">
        <span className="relative flex size-24 items-center justify-center overflow-hidden rounded-full border-[5px] border-background bg-secondary shadow-sm ring-1 ring-border/70">
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
      </span>

      <span className="relative z-10 block truncate font-serif text-base font-medium tracking-[-0.01em] text-foreground">
        {bookTitle}
      </span>
      <span className="relative z-10 mt-1 block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {activityLabel}
      </span>
    </MotionLink>
  );
}
