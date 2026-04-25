import {
  useCallback,
  useMemo,
  type MouseEventHandler,
  type PointerEventHandler,
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

  return useMemo(() => {
    if (!enabled || !chromeVisible || isChromeSuppressed) return null;

    return {
      "aria-hidden": true,
      "data-reader-chrome-dismiss-layer": true,
      onClick: handleDismissLayerClick,
      onPointerDown: handleDismissLayerPointerEvent,
      onPointerMove: handleDismissLayerPointerEvent,
      onPointerUp: handleDismissLayerPointerEvent,
    };
  }, [
    chromeVisible,
    enabled,
    handleDismissLayerClick,
    handleDismissLayerPointerEvent,
    isChromeSuppressed,
  ]);
}
