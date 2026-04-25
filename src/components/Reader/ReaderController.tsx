import type { ChromeInteractionMode } from "@/hooks/use-input-behavior";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  ReaderChromeDismissLayerProps,
  ReaderChromeRailProps,
  ReaderChromeSurfaceProps,
} from "./chrome";
import { useTouchSpreadTapNav } from "./hooks/use-pagination-tap-nav";

export const CHROME_HIDE_DELAY_MS = 200;

interface ReaderControllerChildrenState {
  chromeVisible: boolean;
  showHoverRails: boolean;
  topRailProps: ReaderChromeRailProps;
  bottomRailProps: ReaderChromeRailProps;
  chromeSurfaceProps: ReaderChromeSurfaceProps;
  chromeDismissLayerProps: ReaderChromeDismissLayerProps | null;
}

interface ReaderControllerProps {
  onNextPage: () => void;
  onPrevPage: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  chromeInteractionMode: ChromeInteractionMode;
  isChromeSuppressed?: boolean;
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
 * - exposes a transparent touch dismiss layer when chrome is visible
 * - manages hover enter/leave timing for auto-hidden chrome
 * - suppresses chrome while peer overlays like sheets are open
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
  isChromeSuppressed = false,
  containerRef,
  topRailHeight,
  bottomRailHeight,
  children,
}: ReaderControllerProps) {
  const isHoverMode = chromeInteractionMode === "hover";
  const isTouchMode = chromeInteractionMode === "touch";
  const [chromeVisible, setChromeVisible] = useState(false);
  const hideTimeoutRef = useRef<number | null>(null);
  const previousModeRef = useRef(chromeInteractionMode);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current === null) return;

    window.clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = null;
  }, []);

  const showChrome = useCallback(() => {
    if (isChromeSuppressed) return;
    clearHideTimeout();
    setChromeVisible(true);
  }, [clearHideTimeout, isChromeSuppressed]);

  const hideChrome = useCallback(() => {
    clearHideTimeout();
    setChromeVisible(false);
  }, [clearHideTimeout]);

  const scheduleHideChrome = useCallback(() => {
    clearHideTimeout();
    if (!isHoverMode || isChromeSuppressed) return;

    hideTimeoutRef.current = window.setTimeout(() => {
      setChromeVisible(false);
      hideTimeoutRef.current = null;
    }, CHROME_HIDE_DELAY_MS);
  }, [clearHideTimeout, isChromeSuppressed, isHoverMode]);

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
      setChromeVisible(false);
      previousModeRef.current = chromeInteractionMode;
    }
  }, [chromeInteractionMode, clearHideTimeout]);

  useEffect(() => {
    if (isChromeSuppressed) {
      hideChrome();
    }
  }, [hideChrome, isChromeSuppressed]);

  useTouchSpreadTapNav({
    containerRef,
    enabled: isTouchMode && !isChromeSuppressed,
    onPrevSpread: onPrevPage,
    onNextSpread: onNextPage,
    onShowChrome: showChrome,
    canGoPrev,
    canGoNext,
  });

  const handleDismissLayerPointerEvent = useCallback<PointerEventHandler>(
    (event) => {
      event.stopPropagation();
    },
    [],
  );

  const handleDismissLayerClick = useCallback<MouseEventHandler>(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideChrome();
    },
    [hideChrome],
  );

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
        chromeDismissLayerProps:
          isTouchMode && chromeVisible && !isChromeSuppressed
            ? {
                "aria-hidden": true,
                "data-reader-chrome-dismiss-layer": true,
                onClick: handleDismissLayerClick,
                onPointerDown: handleDismissLayerPointerEvent,
                onPointerMove: handleDismissLayerPointerEvent,
                onPointerUp: handleDismissLayerPointerEvent,
              }
            : null,
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
