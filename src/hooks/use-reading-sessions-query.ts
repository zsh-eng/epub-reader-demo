import { db, type Book, type ReadingSession } from "@/lib/db";
import { useQuery } from "@tanstack/react-query";

export const readingSessionKeys = {
  overview: ["readingSessions", "overview"] as const,
};

function isActiveRecord(record: { isDeleted: boolean }): boolean {
  return !record.isDeleted;
}

export interface ReadingSessionsData {
  books: Book[];
  sessions: ReadingSession[];
}

/** Loads the local-first source records used by the product Sessions page. */
export function useReadingSessionsQuery({
  enabled = true,
}: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: readingSessionKeys.overview,
    enabled,
    queryFn: async (): Promise<ReadingSessionsData> => {
      const [books, sessions] = await Promise.all([
        db.books.filter(isActiveRecord).toArray(),
        db.readingSessions.filter(isActiveRecord).toArray(),
      ]);

      return { books, sessions };
    },
  });
}
