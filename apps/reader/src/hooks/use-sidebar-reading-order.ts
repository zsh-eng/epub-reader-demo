import { useMemo, useState } from "react";
import type { Book } from "@/lib/db";

/**
 * Keep desktop reading destinations in place for one open-sidebar session.
 * Only retain IDs: titles, covers, and reading times still use live book data.
 * New entries join the end and removed entries leave. Reopening captures the
 * latest order; closing retains the old positions through the exit animation.
 */
export function useSidebarReadingOrder(
  books: readonly Book[],
  isOpen: boolean,
) {
  const latestIds = books.map((book) => book.id);
  const [session, setSession] = useState({ isOpen, order: latestIds });
  const retainedOrder = session.order;
  const availableIds = new Set(latestIds);
  const retainedIds = new Set(retainedOrder);
  const nextOrder =
    isOpen && !session.isOpen
      ? latestIds
      : [
          ...retainedOrder.filter((id) => availableIds.has(id)),
          ...latestIds.filter((id) => !retainedIds.has(id)),
        ];
  const sameOrder =
    retainedOrder.length === nextOrder.length &&
    retainedOrder.every((id, index) => id === nextOrder[index]);
  const order = sameOrder ? retainedOrder : nextOrder;

  // Update before commit, so refreshed data cannot paint one reordered frame.
  if (!sameOrder || session.isOpen !== isOpen) setSession({ isOpen, order });

  return useMemo(() => {
    const booksById = new Map(books.map((book) => [book.id, book]));
    return order.map((id) => booksById.get(id)!);
  }, [books, order]);
}
