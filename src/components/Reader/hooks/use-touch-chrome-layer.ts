import {
    useCallback,
    useMemo,
    type MouseEventHandler,
    type PointerEventHandler,
    type SyntheticEvent,
} from "react";
import type { ReaderChromeDismissLayerProps } from "../chrome";

interface UseTouchChromeLayerOptions {
  enabled: boolean;
  chromeVisible: boolean;
  isChromeSuppressed: boolean;
  hideChrome: () => void;
}

/**
 * Produces the transparent touch dismiss layer that sits above the spread while
 * reader chrome is visible. The DOM layer owns interception, so spread tap
 * navigation does not need chrome-visible conditionals.
 */
export function useTouchChromeLayer({
  enabled,
  chromeVisible,
  isChromeSuppressed,
  hideChrome,
}: UseTouchChromeLayerOptions): ReaderChromeDismissLayerProps | null {
  const swallowDismissLayerEvent = useCallback((event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDismissLayerClick = useCallback<MouseEventHandler>(
    (event) => {
      // Android may emit a compatibility click after the touch pointer events.
      // Keep it as an event boundary so the delayed click cannot bubble into
      // click-outside handlers or immediately dismiss newly revealed chrome.
      swallowDismissLayerEvent(event);
    },
    [swallowDismissLayerEvent],
  );

  const handleDismissLayerPointerEvent = useCallback<PointerEventHandler>(
    (event) => {
      swallowDismissLayerEvent(event);
    },
    [swallowDismissLayerEvent],
  );

  const handleDismissLayerPointerUp = useCallback<PointerEventHandler>(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideChrome();
    },
    [hideChrome],
  );

  return useMemo(() => {
    if (!enabled || !chromeVisible || isChromeSuppressed) return null;

    return {
      "aria-hidden": true,
      "data-reader-chrome-dismiss-layer": true,
      onClick: handleDismissLayerClick,
      onPointerDown: handleDismissLayerPointerEvent,
      onPointerMove: handleDismissLayerPointerEvent,
      onPointerUp: handleDismissLayerPointerUp,
    };
  }, [
    chromeVisible,
    enabled,
    handleDismissLayerClick,
    handleDismissLayerPointerEvent,
    handleDismissLayerPointerUp,
    isChromeSuppressed,
  ]);
}
