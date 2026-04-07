import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { usePaginationTapNav } from "./hooks/use-pagination-tap-nav";

interface ReaderControllerChildrenState {
  chromeVisible: boolean;
}

interface ReaderControllerProps {
  onNextPage: () => void;
  onPrevPage: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  tapNavEnabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
  children: (state: ReaderControllerChildrenState) => ReactNode;
}

export function ReaderController({
  onNextPage,
  onPrevPage,
  canGoPrev,
  canGoNext,
  tapNavEnabled,
  containerRef,
  children,
}: ReaderControllerProps) {
  const [chromeVisible, setChromeVisible] = useState(true);

  // Keep controls visible whenever tap-navigation is disabled (desktop/tablet).
  useEffect(() => {
    if (!tapNavEnabled) {
      setChromeVisible(true);
    }
  }, [tapNavEnabled]);

  usePaginationTapNav({
    containerRef,
    enabled: tapNavEnabled,
    onPrevSpread: onPrevPage,
    onNextSpread: onNextPage,
    onToggleChrome: () => setChromeVisible((visible) => !visible),
    canGoPrev,
    canGoNext,
  });

  return <>{children({ chromeVisible })}</>;
}
