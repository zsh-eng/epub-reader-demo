import { useCallback, useMemo, useState } from "react";

export interface ReaderChromeState {
  isBookmarked: boolean;
  isMenuOpen: boolean;
  isSettingsOpen: boolean;
  isChromePinned: boolean;
}

export interface ReaderChromeActions {
  toggleBookmark: () => void;
  openMenu: () => void;
  closeMenu: () => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export interface UseReaderChromeStateResult {
  state: ReaderChromeState;
  actions: ReaderChromeActions;
}

/**
 * Owns ephemeral chrome state for the Reader V2 screen.
 *
 * This hook deliberately stays scoped to screen-local UI concerns like overlays
 * and bookmark affordances. It does not own book/session data, which belongs to
 * the reader session layer.
 */
export function useReaderChromeState(): UseReaderChromeStateResult {
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const toggleBookmark = useCallback(() => {
    setIsBookmarked((bookmarked) => !bookmarked);
  }, []);

  const openMenu = useCallback(() => {
    setIsMenuOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  const openSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const state = useMemo<ReaderChromeState>(
    () => ({
      isBookmarked,
      isMenuOpen,
      isSettingsOpen,
      isChromePinned: isMenuOpen || isSettingsOpen,
    }),
    [isBookmarked, isMenuOpen, isSettingsOpen],
  );

  const actions = useMemo<ReaderChromeActions>(
    () => ({
      toggleBookmark,
      openMenu,
      closeMenu,
      openSettings,
      closeSettings,
    }),
    [closeMenu, closeSettings, openMenu, openSettings, toggleBookmark],
  );

  return {
    state,
    actions,
  };
}
