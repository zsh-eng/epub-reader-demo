import { useBookReadingTimeQuery } from "@/hooks/use-reading-sessions-query";
import { formatReadingDuration } from "@/lib/reading-session-stats";

function compactDuration(milliseconds: number): string {
  return formatReadingDuration(milliseconds)
    .replace(" hr", "h")
    .replace(" min", "m");
}

/** Session updates only render this label; the gesture and scrubber keep their own state. */
export function ReaderPeekReadingTime({
  bookId,
  enabled,
}: {
  bookId: string;
  enabled: boolean;
}) {
  const { data } = useBookReadingTimeQuery(bookId, enabled);

  return (
    <span
      data-testid="reader-peek-reading-time"
      className="whitespace-nowrap pb-1 text-[10px] font-numeric text-muted-foreground tabular-nums"
    >
      {data ? compactDuration(data.todayMs) : "—"} today ·{" "}
      {data ? compactDuration(data.totalMs) : "—"} total
    </span>
  );
}
