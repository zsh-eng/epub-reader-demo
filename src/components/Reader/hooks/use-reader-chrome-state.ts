import { useCallback, useMemo, useState } from "react";
import type { ReaderSheetId } from "../types";

export interface ReaderChromeState {
  isBookmarked: boolean;
  activeReaderSheet: ReaderSheetId | null;
  isChromePinned: boolean;
}

export interface ReaderChromeActions {
  toggleBookmark: () => void;
  openReaderSheet: (sheet: ReaderSheetId) => void;
  closeReaderSheet: () => void;
}

export interface UseReaderChromeStateResult {
  state: ReaderChromeState;
  actions: ReaderChromeActions;
}

/**
 * Owns ephemeral chrome state for the Reader screen.
 *
 * This hook deliberately stays scoped to reader-level chrome concerns like
 * overlay visibility and bookmark affordances. Reader sheets are peer overlays,
 * so the screen-level controller tracks which one is currently active.
 */
export function useReaderChromeState(): UseReaderChromeStateResult {
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [activeReaderSheet, setActiveReaderSheet] =
    useState<ReaderSheetId | null>(null);

  const toggleBookmark = useCallback(() => {
    setIsBookmarked((bookmarked) => !bookmarked);
  }, []);

  const openReaderSheet = useCallback((sheet: ReaderSheetId) => {
    setActiveReaderSheet(sheet);
  }, []);

  const closeReaderSheet = useCallback(() => {
    setActiveReaderSheet(null);
  }, []);

  const state = useMemo<ReaderChromeState>(
    () => ({
      isBookmarked,
      activeReaderSheet,
      isChromePinned: activeReaderSheet !== null,
    }),
    [activeReaderSheet, isBookmarked],
  );

  const actions = useMemo<ReaderChromeActions>(
    () => ({
      toggleBookmark,
      openReaderSheet,
      closeReaderSheet,
    }),
    [closeReaderSheet, openReaderSheet, toggleBookmark],
  );

  return {
    state,
    actions,
  };
}
