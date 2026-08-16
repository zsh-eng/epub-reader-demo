import {
  differenceInCalendarMonths,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachYearOfInterval,
  endOfMonth,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
} from "date-fns";

export type ReadingSessionRange =
  | { kind: "rolling"; days: 7 | 30 | 365 }
  | { kind: "calendar-month"; year: number; month: number }
  | { kind: "calendar-year"; year: number }
  | { kind: "all" };

export const DEFAULT_READING_SESSION_RANGE: ReadingSessionRange = {
  kind: "rolling",
  days: 30,
};

export const MIN_MEANINGFUL_READING_MS = 10 * 60 * 1000;

export interface ReadingSessionAnalyticsRecord {
  id: string;
  bookId: string;
  startedAt: number;
  activeMs: number;
}

export interface ReadingSessionBookRecord {
  id: string;
  title: string;
  author: string;
  coverContentHash?: string;
}

export interface ReadingTimeBucket {
  key: string;
  label: string;
  shortLabel: string;
  activeMs: number;
}

export interface ReadingBookSummary {
  bookId: string;
  title: string;
  author: string;
  coverContentHash?: string;
  activeMs: number;
  sessionCount: number;
  lastReadAt: number;
}

export interface RecentReadingSession {
  id: string;
  bookId: string;
  bookTitle: string;
  startedAt: number;
  activeMs: number;
}

export interface ReadingSessionsOverview {
  totalActiveMs: number;
  sessionCount: number;
  bookCount: number;
  activeDays: number;
  averageSessionMs: number;
  timeBuckets: ReadingTimeBucket[];
  bookSummaries: ReadingBookSummary[];
  recentSessions: RecentReadingSession[];
}

type BucketGranularity = "day" | "month" | "year";

interface BucketDefinition {
  date: Date;
  granularity: BucketGranularity;
  label: string;
  shortLabel: string;
}

interface DateRange {
  start: Date;
  end: Date;
}

function getBucketKey(date: Date, granularity: BucketGranularity): string {
  if (granularity === "day") return format(date, "yyyy-MM-dd");
  if (granularity === "month") return format(date, "yyyy-MM");
  return format(date, "yyyy");
}

function getAllTimeStart(
  now: Date,
  sessions: readonly ReadingSessionAnalyticsRecord[],
): Date {
  const earliestSession = sessions.reduce<number | null>(
    (earliest, session) => {
      if (session.activeMs <= 0 || session.startedAt > now.getTime()) {
        return earliest;
      }
      if (earliest === null) return session.startedAt;
      return Math.min(earliest, session.startedAt);
    },
    null,
  );

  return earliestSession === null
    ? startOfMonth(now)
    : startOfMonth(new Date(earliestSession));
}

function getDateRange(
  range: ReadingSessionRange,
  now: Date,
  sessions: readonly ReadingSessionAnalyticsRecord[],
): DateRange {
  if (range.kind === "rolling") {
    return {
      start: startOfDay(subDays(now, range.days - 1)),
      end: now,
    };
  }

  if (range.kind === "calendar-month") {
    const month = new Date(range.year, range.month, 1);
    return { start: startOfMonth(month), end: endOfMonth(month) };
  }

  if (range.kind === "calendar-year") {
    const year = new Date(range.year, 0, 1);
    return { start: startOfYear(year), end: endOfYear(year) };
  }

  return { start: getAllTimeStart(now, sessions), end: now };
}

function getBucketDefinitions(
  range: ReadingSessionRange,
  start: Date,
  end: Date,
): BucketDefinition[] {
  if (
    (range.kind === "rolling" && range.days !== 365) ||
    range.kind === "calendar-month"
  ) {
    return eachDayOfInterval({ start, end }).map((date) => ({
      date,
      granularity: "day",
      label: format(date, "EEEE, d MMMM"),
      shortLabel:
        range.kind === "rolling" && range.days === 7
          ? format(date, "EEE")
          : format(date, "d"),
    }));
  }

  const monthCount = differenceInCalendarMonths(startOfMonth(end), start) + 1;
  const useYears = range.kind === "all" && monthCount > 18;
  if (useYears) {
    return eachYearOfInterval({
      start: startOfYear(start),
      end,
    }).map((date) => ({
      date,
      granularity: "year",
      label: format(date, "yyyy"),
      shortLabel: format(date, "yyyy"),
    }));
  }

  return eachMonthOfInterval({ start, end }).map((date) => ({
    date,
    granularity: "month",
    label: format(date, "MMMM yyyy"),
    shortLabel:
      range.kind === "all" ? format(date, "MMM yy") : format(date, "MMM"),
  }));
}

export function formatReadingSessionRange(range: ReadingSessionRange): string {
  if (range.kind === "rolling") return `Last ${range.days} days`;
  if (range.kind === "calendar-month") {
    return format(new Date(range.year, range.month, 1), "MMM");
  }
  if (range.kind === "calendar-year") return String(range.year);
  return "All recorded time";
}

export function getTotalRecordedReadingTime(
  sessions: readonly ReadingSessionAnalyticsRecord[],
  now = Date.now(),
): number {
  return sessions.reduce((total, session) => {
    if (session.activeMs <= 0 || session.startedAt > now) return total;
    return total + session.activeMs;
  }, 0);
}

/**
 * Builds the product-facing reading summary from session records. Reading time
 * is assigned to the session start bucket because sessions store accumulated
 * active time, not a timestamp for every active interval.
 */
export function buildReadingSessionsOverview({
  sessions,
  books,
  range,
  now = Date.now(),
}: {
  sessions: readonly ReadingSessionAnalyticsRecord[];
  books: readonly ReadingSessionBookRecord[];
  range: ReadingSessionRange;
  now?: number;
}): ReadingSessionsOverview {
  const nowDate = new Date(now);
  const dateRange = getDateRange(range, nowDate, sessions);
  const rangeStartMs = dateRange.start.getTime();
  const rangeEndMs = Math.min(dateRange.end.getTime(), now);
  const visibleSessions = sessions
    .filter(
      (session) =>
        session.activeMs > 0 &&
        session.startedAt >= rangeStartMs &&
        session.startedAt <= rangeEndMs,
    )
    .sort((a, b) => b.startedAt - a.startedAt);
  const booksById = new Map(books.map((book) => [book.id, book]));
  const bucketDefinitions = getBucketDefinitions(
    range,
    dateRange.start,
    dateRange.end,
  );
  const bucketMsByKey = new Map(
    bucketDefinitions.map((bucket) => [
      getBucketKey(bucket.date, bucket.granularity),
      0,
    ]),
  );

  for (const session of visibleSessions) {
    const sessionDate = new Date(session.startedAt);
    const granularity = bucketDefinitions[0]?.granularity ?? "month";
    const key = getBucketKey(sessionDate, granularity);
    bucketMsByKey.set(key, (bucketMsByKey.get(key) ?? 0) + session.activeMs);
  }

  const bookSummaryById = new Map<string, ReadingBookSummary>();
  for (const session of visibleSessions) {
    const book = booksById.get(session.bookId);
    const current = bookSummaryById.get(session.bookId);
    if (current) {
      current.activeMs += session.activeMs;
      current.sessionCount += 1;
      current.lastReadAt = Math.max(current.lastReadAt, session.startedAt);
      continue;
    }

    bookSummaryById.set(session.bookId, {
      bookId: session.bookId,
      title: book?.title ?? "Unavailable book",
      author: book?.author ?? "",
      coverContentHash: book?.coverContentHash,
      activeMs: session.activeMs,
      sessionCount: 1,
      lastReadAt: session.startedAt,
    });
  }

  const totalActiveMs = visibleSessions.reduce(
    (total, session) => total + session.activeMs,
    0,
  );
  const activeDayKeys = new Set(
    visibleSessions.map((session) =>
      getBucketKey(new Date(session.startedAt), "day"),
    ),
  );

  return {
    totalActiveMs,
    sessionCount: visibleSessions.length,
    bookCount: bookSummaryById.size,
    activeDays: activeDayKeys.size,
    averageSessionMs:
      visibleSessions.length === 0 ? 0 : totalActiveMs / visibleSessions.length,
    timeBuckets: bucketDefinitions.map((bucket) => ({
      key: getBucketKey(bucket.date, bucket.granularity),
      label: bucket.label,
      shortLabel: bucket.shortLabel,
      activeMs:
        bucketMsByKey.get(getBucketKey(bucket.date, bucket.granularity)) ?? 0,
    })),
    bookSummaries: Array.from(bookSummaryById.values()).sort(
      (a, b) => b.activeMs - a.activeMs || b.lastReadAt - a.lastReadAt,
    ),
    recentSessions: visibleSessions
      .filter((session) => session.activeMs >= MIN_MEANINGFUL_READING_MS)
      .slice(0, 6)
      .map((session) => ({
        id: session.id,
        bookId: session.bookId,
        bookTitle: booksById.get(session.bookId)?.title ?? "Unavailable book",
        startedAt: session.startedAt,
        activeMs: session.activeMs,
      })),
  };
}

export function formatReadingDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0 min";

  const totalMinutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}
