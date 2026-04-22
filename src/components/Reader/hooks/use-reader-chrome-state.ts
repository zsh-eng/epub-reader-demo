import { useCallback, useMemo, useState } from "react";

export type ReaderToolsRoute = "root" | "settings";
export type ReaderToolsRouteDirection = 1 | -1;

export interface ReaderChromeState {
  isBookmarked: boolean;
  isToolsOpen: boolean;
  activeToolsRoute: ReaderToolsRoute;
  toolsRouteDirection: ReaderToolsRouteDirection;
  isChromePinned: boolean;
}

export interface ReaderChromeActions {
  toggleBookmark: () => void;
  openTools: () => void;
  closeTools: () => void;
  showToolsRoot: () => void;
  showSettings: () => void;
}

export interface UseReaderChromeStateResult {
  state: ReaderChromeState;
  actions: ReaderChromeActions;
}

/**
 * Owns ephemeral chrome state for the Reader screen.
 *
 * This hook deliberately stays scoped to screen-local UI concerns like overlays
 * and bookmark affordances. It does not own book/session data, which belongs to
 * the reader session layer.
 */
export function useReaderChromeState(): UseReaderChromeStateResult {
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [activeToolsRoute, setActiveToolsRoute] =
    useState<ReaderToolsRoute>("root");
  const [toolsRouteDirection, setToolsRouteDirection] =
    useState<ReaderToolsRouteDirection>(1);

  const toggleBookmark = useCallback(() => {
    setIsBookmarked((bookmarked) => !bookmarked);
  }, []);

  const openTools = useCallback(() => {
    setToolsRouteDirection(1);
    setActiveToolsRoute("root");
    setIsToolsOpen(true);
  }, []);

  const closeTools = useCallback(() => {
    setIsToolsOpen(false);
  }, []);

  const showToolsRoot = useCallback(() => {
    setToolsRouteDirection(-1);
    setActiveToolsRoute("root");
  }, []);

  const showSettings = useCallback(() => {
    setToolsRouteDirection(1);
    setActiveToolsRoute("settings");
    setIsToolsOpen(true);
  }, []);

  const state = useMemo<ReaderChromeState>(
    () => ({
      isBookmarked,
      isToolsOpen,
      activeToolsRoute,
      toolsRouteDirection,
      isChromePinned: isToolsOpen,
    }),
    [activeToolsRoute, isBookmarked, isToolsOpen, toolsRouteDirection],
  );

  const actions = useMemo<ReaderChromeActions>(
    () => ({
      toggleBookmark,
      openTools,
      closeTools,
      showToolsRoot,
      showSettings,
    }),
    [closeTools, openTools, showSettings, showToolsRoot, toggleBookmark],
  );

  return {
    state,
    actions,
  };
}
