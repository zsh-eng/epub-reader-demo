import { db, type SyncedBook, type SyncedReadingSession } from "@/lib/db";
import { useQuery } from "@tanstack/react-query";

export const readingSessionKeys = {
  overview: ["readingSessions", "overview"] as const,
};

function isActiveRecord(record: { _isDeleted?: number }): boolean {
  return record._isDeleted !== 1;
}

export interface ReadingSessionsData {
  books: SyncedBook[];
  sessions: SyncedReadingSession[];
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
