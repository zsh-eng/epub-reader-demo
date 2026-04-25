import { useCallback, useMemo, useState } from "react";
import type { ReaderSheetId } from "../types";

export interface ReaderChromeState {
  isBookmarked: boolean;
  activeReaderSheet: ReaderSheetId | null;
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
 * bookmark affordances and the active peer sheet. Chrome visibility itself is
 * owned by ReaderController because hover and touch modes reveal it differently.
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
