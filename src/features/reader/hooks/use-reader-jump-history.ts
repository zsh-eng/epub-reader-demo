import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import type { ContentAnchor, SpreadIntent } from "@/lib/pagination-v2";
import {
  EMPTY_READER_HISTORY,
  ReaderJumpHistoryController,
} from "../jump-history";
import {
  loadReaderJumpHistory,
  saveReaderJumpHistory,
} from "../data/jump-history-storage";

/** A book-scoped controller. Worker results update it directly, before React
 * can batch renders, so intermediate confirmed jumps are not lost.
 */
export function useReaderJumpHistory(bookId: string, sourceFileId: string) {
  const owner = useMemo(() => {
    let initial = EMPTY_READER_HISTORY;
    try {
      initial = loadReaderJumpHistory(
        getRuntimeStorage(),
        bookId,
        sourceFileId,
      );
    } catch {
      /* Storage can be unavailable; navigation still works in memory. */
    }
    const controller = new ReaderJumpHistoryController(initial);
    const listeners = new Set<() => void>();
    return {
      controller,
      initialAnchor:
        controller.getSnapshot().entries[controller.getSnapshot().cursor]
          ?.anchor,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      record(anchor: ContentAnchor, intent: SpreadIntent) {
        if (!bookId || !sourceFileId) return;
        const previous = controller.getSnapshot();
        const next = controller.record(anchor, intent);
        if (next === previous) return;
        try {
          saveReaderJumpHistory(
            getRuntimeStorage(),
            bookId,
            sourceFileId,
            next,
          );
        } catch (error) {
          console.warn("Could not save Reader jump history", error);
        }
        listeners.forEach((listener) => listener());
      },
    };
  }, [bookId, sourceFileId]);
  const state = useSyncExternalStore(
    owner.subscribe,
    owner.controller.getSnapshot,
  );
  const go = useCallback(
    (
      direction: "back" | "forward",
      navigate: (
        anchor: ContentAnchor,
        options: { intent: SpreadIntent },
      ) => void,
    ) => {
      const target = owner.controller.getReturnTarget(direction);
      if (target) navigate(target.anchor, { intent: target.intent });
    },
    [owner],
  );
  return {
    state,
    initialAnchor: owner.initialAnchor,
    record: owner.record,
    endGroup: owner.controller.endGroup,
    go,
  };
}
