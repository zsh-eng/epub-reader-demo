import type { ChromeInteractionMode } from "@/hooks/use-input-behavior";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  ReaderChromeDismissLayerProps,
  ReaderChromeRailProps,
  ReaderChromeSurfaceProps,
} from "./chrome";
import {
  CHROME_HIDE_DELAY_MS,
  useHoverChromeBehavior,
} from "./hooks/use-hover-chrome-behavior";
import { useTouchChromeLayer } from "./hooks/use-touch-chrome-layer";
import { useTouchSpreadTapNav } from "./hooks/use-touch-spread-tap-nav";

export { CHROME_HIDE_DELAY_MS };

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
  const previousModeRef = useRef(chromeInteractionMode);

  const showChrome = useCallback(() => {
    if (isChromeSuppressed) return;
    setChromeVisible(true);
  }, [isChromeSuppressed]);

  const hideChrome = useCallback(() => {
    setChromeVisible(false);
  }, []);

  useEffect(() => {
    if (previousModeRef.current !== chromeInteractionMode) {
      setChromeVisible(false);
      previousModeRef.current = chromeInteractionMode;
    }
  }, [chromeInteractionMode]);

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

  const hoverChrome = useHoverChromeBehavior({
    enabled: isHoverMode,
    isChromeSuppressed,
    topRailHeight,
    bottomRailHeight,
    showChrome,
    hideChrome,
  });

  const chromeDismissLayerProps = useTouchChromeLayer({
    enabled: isTouchMode,
    chromeVisible,
    isChromeSuppressed,
    hideChrome,
  });

  return (
    <>
      {children({
        chromeVisible,
        showHoverRails: hoverChrome.showHoverRails,
        chromeDismissLayerProps,
        topRailProps: hoverChrome.topRailProps,
        bottomRailProps: hoverChrome.bottomRailProps,
        chromeSurfaceProps: hoverChrome.chromeSurfaceProps,
      })}
    </>
  );
}
