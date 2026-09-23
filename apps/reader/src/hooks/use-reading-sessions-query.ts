import {
  db,
  getBookReadingSessions,
  type Book,
  type ReadingSession,
} from "@/lib/db";
import { getRecordedReadingTimeSummary } from "@/lib/reading-session-stats";
import { useQuery } from "@tanstack/react-query";

export const readingSessionKeys = {
  overview: ["readingSessions", "overview"] as const,
  bookTime: (bookId: string) =>
    ["readingSessions", "bookTime", bookId] as const,
};

function isActiveRecord(record: { isDeleted: boolean }): boolean {
  return !record.isDeleted;
}

export interface ReadingSessionsData {
  books: Book[];
  sessions: ReadingSession[];
}

/** Loads the local-first source records used by the product Sessions page. */
export function useReadingSessionsQuery() {
  return useQuery({
    queryKey: readingSessionKeys.overview,
    queryFn: async (): Promise<ReadingSessionsData> => {
      const [books, sessions] = await Promise.all([
        db.books.filter(isActiveRecord).toArray(),
        db.readingSessions.filter(isActiveRecord).toArray(),
      ]);

      return { books, sessions };
    },
  });
}

/** Keeps the peek's local read scoped to the open book and off the content-loading path. */
export function useBookReadingTimeQuery(bookId: string, enabled: boolean) {
  return useQuery({
    queryKey: readingSessionKeys.bookTime(bookId),
    queryFn: async () =>
      getRecordedReadingTimeSummary(await getBookReadingSessions(bookId)),
    networkMode: "always",
    enabled,
  });
}
