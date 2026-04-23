import { useCallback, useMemo, useState } from "react";

export interface ReaderChromeState {
  isBookmarked: boolean;
  isToolsOpen: boolean;
  isChromePinned: boolean;
}

export interface ReaderChromeActions {
  toggleBookmark: () => void;
  openTools: () => void;
  closeTools: () => void;
}

export interface UseReaderChromeStateResult {
  state: ReaderChromeState;
  actions: ReaderChromeActions;
}

/**
 * Owns ephemeral chrome state for the Reader screen.
 *
 * This hook deliberately stays scoped to reader-level chrome concerns like
 * overlay visibility and bookmark affordances. Nested navigation inside a
 * specific sheet lives with that sheet component instead of this screen-level
 * controller.
 */
export function useReaderChromeState(): UseReaderChromeStateResult {
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);

  const toggleBookmark = useCallback(() => {
    setIsBookmarked((bookmarked) => !bookmarked);
  }, []);

  const openTools = useCallback(() => {
    setIsToolsOpen(true);
  }, []);

  const closeTools = useCallback(() => {
    setIsToolsOpen(false);
  }, []);

  const state = useMemo<ReaderChromeState>(
    () => ({
      isBookmarked,
      isToolsOpen,
      isChromePinned: isToolsOpen,
    }),
    [isBookmarked, isToolsOpen],
  );

  const actions = useMemo<ReaderChromeActions>(
    () => ({
      toggleBookmark,
      openTools,
      closeTools,
    }),
    [closeTools, openTools, toggleBookmark],
  );

  return {
    state,
    actions,
  };
}
