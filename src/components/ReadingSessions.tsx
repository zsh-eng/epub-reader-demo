import { Skeleton } from "@/components/ui/skeleton";
import { SEGMENTED_PILL_TRANSITION } from "@/components/ui/segmented-controls";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import { useReadingSessionsQuery } from "@/hooks/use-reading-sessions-query";
import {
  buildReadingSessionsOverview,
  DEFAULT_READING_SESSION_RANGE,
  formatReadingDuration,
  formatReadingSessionRange,
  getTotalRecordedReadingTime,
  MIN_MEANINGFUL_READING_MS,
  type ReadingSessionAnalyticsRecord,
  type ReadingSessionBookRecord,
  type ReadingSessionRange,
  type ReadingTimeBucket,
} from "@/lib/reading-session-stats";
import { format, formatDistanceToNow, subMonths } from "date-fns";
import { BookOpenText, CalendarDays, Clock3, Timer } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type ReadingSessionScale = "week" | "month" | "year" | "all";

const SCALE_OPTIONS: { label: string; value: ReadingSessionScale }[] = [
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "Year", value: "year" },
  { label: "All", value: "all" },
];

interface RangeOption {
  label: string;
  range: ReadingSessionRange;
}

function getRangeKey(range: ReadingSessionRange): string {
  if (range.kind === "rolling") return `rolling-${range.days}`;
  if (range.kind === "calendar-month") {
    return `month-${range.year}-${range.month}`;
  }
  if (range.kind === "calendar-year") return `year-${range.year}`;
  return "all";
}

function getMonthOptions(now: Date): RangeOption[] {
  const calendarMonths = Array.from({ length: 12 }, (_, index) => {
    const date = subMonths(now, index);
    return {
      label: format(date, "MMM"),
      range: {
        kind: "calendar-month",
        year: date.getFullYear(),
        month: date.getMonth(),
      } satisfies ReadingSessionRange,
    };
  });

  return [
    { label: "Last 30 days", range: DEFAULT_READING_SESSION_RANGE },
    ...calendarMonths,
  ];
}

function getYearOptions(
  sessions: readonly ReadingSessionAnalyticsRecord[],
  now: Date,
): RangeOption[] {
  const currentYear = now.getFullYear();
  const earliestRecordedYear = sessions.reduce((earliest, session) => {
    if (session.activeMs <= 0 || session.startedAt > now.getTime()) {
      return earliest;
    }
    return Math.min(earliest, new Date(session.startedAt).getFullYear());
  }, currentYear);
  const oldestVisibleYear = Math.min(currentYear - 1, earliestRecordedYear);
  const calendarYears = Array.from(
    { length: currentYear - oldestVisibleYear + 1 },
    (_, index) => currentYear - index,
  );

  return [
    {
      label: "Last 365 days",
      range: { kind: "rolling", days: 365 },
    },
    ...calendarYears.map((year) => ({
      label: String(year),
      range: { kind: "calendar-year", year } as ReadingSessionRange,
    })),
  ];
}

function TimeRangeNavigator({
  scale,
  range,
  rangeOptions,
  onScaleChange,
  onRangeChange,
}: {
  scale: ReadingSessionScale;
  range: ReadingSessionRange;
  rangeOptions: RangeOption[];
  onScaleChange: (scale: ReadingSessionScale) => void;
  onRangeChange: (range: ReadingSessionRange) => void;
}) {
  const activeRangeKey = getRangeKey(range);
  const scaleLayoutGroupId = useId();
  const rangeLayoutGroupId = useId();
  const reducedMotion = useReducedMotion() ?? false;
  const selectionTransition = reducedMotion
    ? { duration: 0 }
    : SEGMENTED_PILL_TRANSITION;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <LayoutGroup id={scaleLayoutGroupId}>
        <nav
          aria-label="Reading history scale"
          className="relative isolate mx-auto flex h-9 w-full max-w-sm rounded-xl bg-muted p-1"
        >
          {SCALE_OPTIONS.map((option) => {
            const isActive = option.value === scale;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => onScaleChange(option.value)}
                className={`relative flex-1 cursor-pointer rounded-lg px-3 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {isActive && (
                  <motion.span
                    layout="position"
                    layoutId="sessions-scale-selection"
                    aria-hidden="true"
                    initial={false}
                    transition={selectionTransition}
                    className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] bg-background shadow-sm ring-1 ring-border/70"
                  />
                )}
                <span className="relative z-10">{option.label}</span>
              </button>
            );
          })}
        </nav>
      </LayoutGroup>

      <LayoutGroup id={rangeLayoutGroupId}>
        <nav
          aria-label="Reading history period"
          className="relative isolate mt-2 -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {rangeOptions.map((option) => {
            const optionKey = getRangeKey(option.range);
            const isActive = optionKey === activeRangeKey;
            return (
              <button
                key={optionKey}
                type="button"
                aria-pressed={isActive}
                onClick={() => onRangeChange(option.range)}
                className="relative shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium text-foreground outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                {isActive && (
                  <motion.span
                    layout="position"
                    layoutId={`sessions-range-selection-${scale}`}
                    aria-hidden="true"
                    initial={false}
                    transition={selectionTransition}
                    className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] bg-secondary shadow-sm ring-1 ring-border/70"
                  />
                )}
                <span className="relative z-10">{option.label}</span>
              </button>
            );
          })}
        </nav>
      </LayoutGroup>
    </div>
  );
}

function ReadingTimeChart({ buckets }: { buckets: ReadingTimeBucket[] }) {
  const maxActiveMs = Math.max(...buckets.map((bucket) => bucket.activeMs), 1);

  return (
    <div className="relative h-64 pt-3" aria-label="Reading time chart">
      <div className="pointer-events-none absolute inset-x-0 top-3 bottom-7 flex flex-col justify-between">
        {[0, 1, 2, 3].map((line) => (
          <span key={line} className="border-t border-border/60" />
        ))}
      </div>
      <ol
        className="relative grid h-full gap-1"
        style={{
          gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
        }}
      >
        {buckets.map((bucket, index) => {
          const height = (bucket.activeMs / maxActiveMs) * 100;
          const showLabel =
            buckets.length <= 12 ||
            index === 0 ||
            index === buckets.length - 1 ||
            index % 5 === 0;

          return (
            <li
              key={bucket.key}
              className="flex min-w-0 flex-col items-center gap-2"
            >
              <div className="relative flex min-h-0 w-full flex-1 items-end justify-center">
                {bucket.activeMs > 0 && (
                  <span
                    className="group relative block w-full max-w-8"
                    style={{ height: `${Math.max(2, height)}%` }}
                  >
                    <span
                      tabIndex={0}
                      role="img"
                      aria-label={`${bucket.label}: ${formatReadingDuration(bucket.activeMs)}`}
                      className="block size-full rounded-t-[5px] rounded-b-[2px] bg-chart-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <span className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-1/2 z-10 hidden w-max -translate-x-1/2 rounded-xl border bg-popover px-3 py-2 text-left text-popover-foreground opacity-0 shadow-lg group-hover:block group-hover:opacity-100 group-focus-within:block group-focus-within:opacity-100">
                      <span className="block text-[11px] text-muted-foreground">
                        {bucket.label}
                      </span>
                      <span className="mt-0.5 block text-xs font-medium">
                        {formatReadingDuration(bucket.activeMs)}
                      </span>
                    </span>
                  </span>
                )}
              </div>
              <span className="h-4 truncate text-[10px] text-muted-foreground">
                {showLabel ? bucket.shortLabel : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex min-h-36 flex-col justify-between rounded-3xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      <div>
        <p className="font-serif text-3xl font-medium tracking-tight">
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function SessionsLoadingState() {
  return (
    <div className="space-y-4" aria-label="Loading reading sessions">
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-44 rounded-3xl" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-44 rounded-3xl" />
          <Skeleton className="h-44 rounded-3xl" />
        </div>
      </div>
      <Skeleton className="h-80 rounded-3xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-3xl" />
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    </div>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-44 items-center justify-center rounded-2xl border border-dashed px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

type ReadingInvitation =
  | { kind: "empty-library" }
  | {
      kind: "keep-reading";
      bookId: string;
      bookTitle: string;
      hasStartedReading: boolean;
    };

function getReadingInvitation(
  books: readonly ReadingSessionBookRecord[],
  sessions: readonly ReadingSessionAnalyticsRecord[],
  totalRecordedReadingTime: number,
  now: number,
): ReadingInvitation {
  const firstBook = books.at(0);
  if (!firstBook) return { kind: "empty-library" };

  const booksById = new Map(books.map((book) => [book.id, book]));
  let targetBook = firstBook;
  let latestReadAt = Number.NEGATIVE_INFINITY;

  for (const session of sessions) {
    if (
      session.activeMs <= 0 ||
      session.startedAt > now ||
      session.startedAt <= latestReadAt
    ) {
      continue;
    }

    const book = booksById.get(session.bookId);
    if (!book) continue;
    targetBook = book;
    latestReadAt = session.startedAt;
  }

  return {
    kind: "keep-reading",
    bookId: targetBook.id,
    bookTitle: targetBook.title,
    hasStartedReading: totalRecordedReadingTime > 0,
  };
}

function SessionsHeader() {
  return (
    <header className="px-4 pt-10 pb-5 text-center md:pt-14 md:pb-7">
      <h1 className="font-serif text-5xl font-medium leading-none tracking-tight md:text-6xl">
        Sessions
      </h1>
    </header>
  );
}

function SessionsEmptyState({ invitation }: { invitation: ReadingInvitation }) {
  const hasEmptyLibrary = invitation.kind === "empty-library";
  const title = hasEmptyLibrary ? "Find your next book" : "Keep reading";
  const description = hasEmptyLibrary
    ? "Add something to your library and begin. Your reading history will gather here as you go."
    : invitation.hasStartedReading
      ? `Return to ${invitation.bookTitle} and let your reading history take shape.`
      : `Open ${invitation.bookTitle} and begin your reading history.`;
  const destination = hasEmptyLibrary ? "/" : `/reader/${invitation.bookId}`;
  const action = hasEmptyLibrary
    ? "Browse library"
    : invitation.hasStartedReading
      ? "Continue reading"
      : "Start reading";

  return (
    <main className="flex flex-1 items-center justify-center px-6 pt-4 pb-20">
      <section className="flex max-w-md flex-col items-center text-center">
        <div
          className="relative mb-8 grid size-32 place-items-center"
          aria-hidden="true"
        >
          <span className="absolute h-24 w-16 -translate-x-4 -rotate-8 rounded-r-2xl rounded-l-md border bg-muted" />
          <span className="absolute h-24 w-16 translate-x-4 rotate-8 rounded-r-2xl rounded-l-md border bg-secondary" />
          <span className="relative grid h-24 w-16 place-items-center rounded-r-2xl rounded-l-md border bg-card shadow-lg">
            <BookOpenText className="size-7 text-muted-foreground" />
          </span>
        </div>
        <h2 className="font-serif text-3xl font-medium tracking-tight md:text-4xl">
          {title}
        </h2>
        <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        <Link
          to={destination}
          className="mt-7 inline-flex min-h-10 items-center justify-center rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background outline-none transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          {action}
        </Link>
      </section>
    </main>
  );
}

function RecentReadingEmptyState({
  bookId,
  bookTitle,
}: {
  bookId: string;
  bookTitle: string;
}) {
  return (
    <div className="flex min-h-72 flex-1 flex-col items-center justify-center px-5 py-8 text-center">
      <span className="mb-5 grid size-14 place-items-center rounded-full bg-secondary">
        <BookOpenText
          className="size-5 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <p className="max-w-xs font-serif text-2xl font-medium tracking-tight">
        Continue {bookTitle}
      </p>
      <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
        Return to your book and your next reading session will appear here.
      </p>
      <Link
        to={`/reader/${bookId}`}
        className="mt-6 inline-flex min-h-9 items-center justify-center rounded-full border bg-background px-4 py-2 text-sm font-medium outline-none transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        Continue reading
      </Link>
    </div>
  );
}

export function ReadingSessions() {
  const [scale, setScale] = useState<ReadingSessionScale>("month");
  const [rangesByScale, setRangesByScale] = useState<
    Record<ReadingSessionScale, ReadingSessionRange>
  >({
    week: { kind: "rolling", days: 7 },
    month: DEFAULT_READING_SESSION_RANGE,
    year: { kind: "rolling", days: 365 },
    all: { kind: "all" },
  });
  const [now] = useState(() => new Date());
  const query = useReadingSessionsQuery();
  const range = rangesByScale[scale];
  const rangeOptions = useMemo(() => {
    if (scale === "week") {
      return [{ label: "Last 7 days", range: rangesByScale.week }];
    }
    if (scale === "month") return getMonthOptions(now);
    if (scale === "year") {
      return getYearOptions(query.data?.sessions ?? [], now);
    }
    return [{ label: "All recorded time", range: rangesByScale.all }];
  }, [now, query.data?.sessions, rangesByScale.all, rangesByScale.week, scale]);
  const rangeLabel = formatReadingSessionRange(range);
  const overview = useMemo(
    () =>
      buildReadingSessionsOverview({
        sessions: query.data?.sessions ?? [],
        books: query.data?.books ?? [],
        range,
      }),
    [query.data?.books, query.data?.sessions, range],
  );
  const summaryBooks = useMemo(() => {
    const booksById = new Map(
      (query.data?.books ?? []).map((book) => [book.id, book]),
    );
    return overview.bookSummaries
      .map((summary) => booksById.get(summary.bookId))
      .filter((book) => book !== undefined);
  }, [overview.bookSummaries, query.data?.books]);
  const { coverUrls } = useLibraryCoverUrls(summaryBooks);
  const maxBookTime = overview.bookSummaries[0]?.activeMs ?? 0;
  const totalRecordedReadingTime = useMemo(
    () =>
      getTotalRecordedReadingTime(query.data?.sessions ?? [], now.getTime()),
    [now, query.data?.sessions],
  );
  const invitation = useMemo(
    () =>
      getReadingInvitation(
        query.data?.books ?? [],
        query.data?.sessions ?? [],
        totalRecordedReadingTime,
        now.getTime(),
      ),
    [now, query.data?.books, query.data?.sessions, totalRecordedReadingTime],
  );
  if (query.isLoading) {
    return (
      <div className="min-h-svh bg-background text-foreground">
        <SessionsHeader />
        <main className="mx-auto w-full max-w-6xl px-4 pt-4 pb-12 md:px-8">
          <SessionsLoadingState />
        </main>
      </div>
    );
  }

  if (query.error) {
    return (
      <div className="flex min-h-svh flex-col bg-background text-foreground">
        <SessionsHeader />
        <main className="flex flex-1 items-center justify-center px-4 pb-16">
          <div className="w-full max-w-xl">
            <EmptyPanel>
              Reading history could not be loaded. Please try again.
            </EmptyPanel>
          </div>
        </main>
      </div>
    );
  }

  if (
    invitation.kind === "empty-library" ||
    totalRecordedReadingTime < MIN_MEANINGFUL_READING_MS
  ) {
    return (
      <div className="flex min-h-svh flex-col bg-background text-foreground">
        <SessionsHeader />
        <SessionsEmptyState invitation={invitation} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SessionsHeader />

      <div className="sticky top-0 z-30 border-y bg-background px-4 py-3 md:static md:border-0 md:pt-0 md:pb-4">
        <TimeRangeNavigator
          scale={scale}
          range={range}
          rangeOptions={rangeOptions}
          onScaleChange={setScale}
          onRangeChange={(nextRange) => {
            setRangesByScale((current) => ({
              ...current,
              [scale]: nextRange,
            }));
          }}
        />
      </div>

      <main className="mx-auto w-full max-w-6xl px-4 pt-4 pb-12 md:px-8">
        <div className="space-y-4">
          <section className="grid gap-3 lg:grid-cols-2">
            <div className="flex min-h-44 flex-col justify-between overflow-hidden rounded-3xl border bg-card p-6 text-card-foreground shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                <Clock3 className="size-3.5" aria-hidden="true" />
                Reading time
              </div>
              <div>
                <p className="font-serif text-4xl font-medium tracking-tight sm:text-5xl">
                  {formatReadingDuration(overview.totalActiveMs)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {overview.sessionCount.toLocaleString()} reading session
                  {overview.sessionCount === 1 ? "" : "s"} across{" "}
                  {overview.bookCount.toLocaleString()} book
                  {overview.bookCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Metric
                icon={CalendarDays}
                label="Active days"
                value={overview.activeDays.toLocaleString()}
                detail={rangeLabel}
              />
              <Metric
                icon={Timer}
                label="Typical visit"
                value={formatReadingDuration(overview.averageSessionMs)}
                detail="Average active time"
              />
            </div>
          </section>

          <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-2xl font-medium tracking-tight">
                  Reading over time
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {rangeLabel}
                </p>
              </div>
            </div>

            {overview.totalActiveMs > 0 ? (
              <ReadingTimeChart buckets={overview.timeBuckets} />
            ) : (
              <EmptyPanel>No reading recorded for this period.</EmptyPanel>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
              <div className="mb-5">
                <h2 className="font-serif text-2xl font-medium tracking-tight">
                  Time with each book
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your reading time in this period.
                </p>
              </div>

              {overview.bookSummaries.length > 0 ? (
                <div className="space-y-1">
                  {overview.bookSummaries.slice(0, 6).map((book) => {
                    const coverUrl = coverUrls.get(book.bookId);
                    const share =
                      maxBookTime === 0 ? 0 : book.activeMs / maxBookTime;

                    return (
                      <Link
                        key={book.bookId}
                        to={`/reader/${book.bookId}`}
                        className="group flex min-w-0 items-center gap-3 rounded-2xl p-2 outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex aspect-2/3 w-10 shrink-0 items-center justify-center overflow-hidden rounded-r-md rounded-l-xs border bg-muted shadow-sm">
                          {coverUrl ? (
                            <img
                              src={coverUrl}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : (
                            <BookOpenText
                              className="size-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-sm font-medium">
                              {book.title}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {formatReadingDuration(book.activeMs)}
                            </span>
                          </span>
                          {book.author && (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {book.author}
                            </span>
                          )}
                          <span className="mt-2 block h-1 overflow-hidden rounded-full bg-muted">
                            <span
                              className="block h-full rounded-full bg-foreground/55"
                              style={{
                                width: `${Math.max(4, share * 100)}%`,
                              }}
                            />
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <EmptyPanel>No books were read in this period.</EmptyPanel>
              )}
            </section>

            <section className="flex min-h-96 flex-col rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
              <div className="mb-5">
                <h2 className="font-serif text-2xl font-medium tracking-tight">
                  Recent reading
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your latest reading sessions.
                </p>
              </div>

              {overview.recentSessions.length > 0 ? (
                <ol className="divide-y divide-border/70">
                  {overview.recentSessions.map((session) => (
                    <li key={session.id}>
                      <Link
                        to={`/reader/${session.bookId}`}
                        className="flex items-center justify-between gap-4 rounded-xl px-2 py-3 outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {session.bookTitle}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(session.startedAt), {
                              addSuffix: true,
                            })}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatReadingDuration(session.activeMs)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <RecentReadingEmptyState
                  bookId={invitation.bookId}
                  bookTitle={invitation.bookTitle}
                />
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
