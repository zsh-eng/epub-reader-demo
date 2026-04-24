import type { ChromeInteractionMode } from "@/hooks/use-input-behavior";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEventHandler,
  type ReactNode,
  type RefObject,
} from "react";
import type { ReaderChromeRailProps, ReaderChromeSurfaceProps } from "./chrome";
import { usePaginationTapNav } from "./hooks/use-pagination-tap-nav";

export const CHROME_HIDE_DELAY_MS = 200;

interface ReaderControllerChildrenState {
  chromeVisible: boolean;
  showHoverRails: boolean;
  topRailProps: ReaderChromeRailProps;
  bottomRailProps: ReaderChromeRailProps;
  chromeSurfaceProps: ReaderChromeSurfaceProps;
}

interface ReaderControllerProps {
  onNextPage: () => void;
  onPrevPage: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  chromeInteractionMode: ChromeInteractionMode;
  isChromePinned: boolean;
  containerRef: RefObject<HTMLElement | null>;
  topRailHeight: number;
  bottomRailHeight: number;
  children: (state: ReaderControllerChildrenState) => ReactNode;
}

/**
 * Headless auto-hiding chrome controller for the paginated reader.
 *
 * Responsibilities:
 * - switches between touch and hover chrome behavior
 * - keeps tap-zone navigation active only in touch mode
 * - manages hover enter/leave timing for auto-hidden chrome
 * - keeps chrome visible while the reader pins it open (menus/settings)
 *
 * Contract for callers:
 * - render the returned top/bottom hover rails in the non-reading bands
 * - spread `chromeSurfaceProps` onto any chrome surface that should keep the
 *   chrome visible while hovered or focused
 *
 * The controller is intentionally headless so the reader layout stays in
 * charge of where rails and chrome surfaces live.
 */
export function ReaderController({
  onNextPage,
  onPrevPage,
  canGoPrev,
  canGoNext,
  chromeInteractionMode,
  isChromePinned,
  containerRef,
  topRailHeight,
  bottomRailHeight,
  children,
}: ReaderControllerProps) {
  const isHoverMode = chromeInteractionMode === "hover";
  const [chromeVisible, setChromeVisible] = useState(
    !isHoverMode || isChromePinned,
  );
  const hideTimeoutRef = useRef<number | null>(null);
  const previousModeRef = useRef(chromeInteractionMode);
  const previousPinnedRef = useRef(isChromePinned);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current === null) return;

    window.clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = null;
  }, []);

  const showChrome = useCallback(() => {
    clearHideTimeout();
    setChromeVisible(true);
  }, [clearHideTimeout]);

  const scheduleHideChrome = useCallback(() => {
    clearHideTimeout();
    if (!isHoverMode || isChromePinned) return;

    hideTimeoutRef.current = window.setTimeout(() => {
      setChromeVisible(false);
      hideTimeoutRef.current = null;
    }, CHROME_HIDE_DELAY_MS);
  }, [clearHideTimeout, isChromePinned, isHoverMode]);

  const handleChromeFocus = useCallback(() => {
    if (!isHoverMode) return;
    showChrome();
  }, [isHoverMode, showChrome]);

  const handleChromeBlur = useCallback<FocusEventHandler<HTMLElement>>(
    (event) => {
      if (!isHoverMode) return;

      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        event.currentTarget.contains(nextTarget)
      ) {
        return;
      }

      scheduleHideChrome();
    },
    [isHoverMode, scheduleHideChrome],
  );

  const handleChromePointerEnter = useCallback(() => {
    if (!isHoverMode) return;
    showChrome();
  }, [isHoverMode, showChrome]);

  const handleChromePointerLeave = useCallback(() => {
    if (!isHoverMode) return;
    scheduleHideChrome();
  }, [isHoverMode, scheduleHideChrome]);

  useEffect(() => {
    return () => {
      clearHideTimeout();
    };
  }, [clearHideTimeout]);

  useEffect(() => {
    if (previousModeRef.current !== chromeInteractionMode) {
      clearHideTimeout();
      setChromeVisible(chromeInteractionMode === "touch" || isChromePinned);
      previousModeRef.current = chromeInteractionMode;
    }
  }, [chromeInteractionMode, clearHideTimeout, isChromePinned]);

  useEffect(() => {
    if (isChromePinned && !previousPinnedRef.current) {
      showChrome();
    } else if (!isChromePinned && previousPinnedRef.current) {
      scheduleHideChrome();
    }

    previousPinnedRef.current = isChromePinned;
  }, [isChromePinned, scheduleHideChrome, showChrome]);

  usePaginationTapNav({
    containerRef,
    enabled: chromeInteractionMode === "touch",
    onPrevSpread: onPrevPage,
    onNextSpread: onNextPage,
    onToggleChrome: () => setChromeVisible((visible) => !visible),
    canGoPrev,
    canGoNext,
  });

  const chromeSurfaceProps: ReaderChromeSurfaceProps = {
    onBlur: handleChromeBlur,
    onFocus: handleChromeFocus,
    onPointerEnter: handleChromePointerEnter,
    onPointerLeave: handleChromePointerLeave,
  };

  return (
    <>
      {children({
        chromeVisible,
        showHoverRails: isHoverMode,
        topRailProps: {
          "aria-hidden": true,
          "data-reader-chrome-rail": "top",
          onPointerEnter: handleChromePointerEnter,
          onPointerLeave: handleChromePointerLeave,
          style: { height: `${topRailHeight}px` },
        },
        bottomRailProps: {
          "aria-hidden": true,
          "data-reader-chrome-rail": "bottom",
          onPointerEnter: handleChromePointerEnter,
          onPointerLeave: handleChromePointerLeave,
          style: { height: `${bottomRailHeight}px` },
        },
        chromeSurfaceProps,
      })}
    </>
  );
}
