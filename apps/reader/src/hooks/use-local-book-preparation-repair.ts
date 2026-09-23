import { bookKeys } from "@/hooks/use-book-loader";
import { prepareBook } from "@/lib/book-preparation";
import type { Book } from "@/lib/db";
import { files } from "@/lib/files";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

/** Rebuild missing artifacts only for source EPUBs already on this device. */
export function useLocalBookPreparationRepair(
  books: readonly Book[],
  enabled: boolean,
): void {
  const queryClient = useQueryClient();
  const repairKey = useMemo(
    () =>
      books
        .map(
          (book) =>
            `${book.id}:${book.sourceFileId}:${book.cover?.blurHash ?? "none"}`,
        )
        .join("|"),
    [books],
  );
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const cancelSchedule = scheduleBackgroundWork(() => {
      void repairLocalBookPreparations(books, () => cancelled).then(
        (bookChanged) => {
          if (!cancelled && bookChanged) {
            void queryClient.invalidateQueries({ queryKey: bookKeys.all });
          }
        },
      );
    });

    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, [books, enabled, queryClient, repairKey]);
}

export async function repairLocalBookPreparations(
  books: readonly Book[],
  isCancelled: () => boolean = () => false,
): Promise<boolean> {
  let bookChanged = false;

  for (const book of books) {
    if (isCancelled()) return bookChanged;
    if (!(await files.hasLocal(book.sourceFileId))) continue;

    try {
      const result = await prepareBook(book);
      bookChanged ||= result.bookChanged;
    } catch (error) {
      console.error(`Could not prepare local book ${book.id}:`, error);
    }
  }

  return bookChanged;
}

function scheduleBackgroundWork(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 2_000 });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(callback, 250);
  return () => window.clearTimeout(id);
}
