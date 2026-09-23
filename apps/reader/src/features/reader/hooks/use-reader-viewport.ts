import { useEffect, useState } from "react";

interface ReaderViewport {
  width: number;
  height: number;
}

interface UseReaderViewportOptions {
  isMobile: boolean;
  isPanelOpen: boolean;
  initialViewport?: ReaderViewport;
  initialAutoMode?: boolean;
}

const DEFAULT_VIEWPORT: ReaderViewport = { width: 620, height: 860 };
const PANEL_WIDTH_PX = 320;
const PANEL_COUNT = 2;
const MIN_VIEWPORT_WIDTH_PX = 240;
const MAX_VIEWPORT_WIDTH_PX = 1440;
const MIN_VIEWPORT_HEIGHT_PX = 300;
const MAX_VIEWPORT_HEIGHT_PX = 980;
const MOBILE_HORIZONTAL_PADDING_PX = 32;
const DESKTOP_HORIZONTAL_PADDING_PX = 120;
const MOBILE_VERTICAL_PADDING_PX = 270;
const DESKTOP_VERTICAL_PADDING_PX = 300;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getAutoViewport(options: {
  isMobile: boolean;
  isPanelOpen: boolean;
}): ReaderViewport {
  const panelWidth =
    !options.isMobile && options.isPanelOpen ? PANEL_WIDTH_PX * PANEL_COUNT : 0;
  const horizontalPadding =
    (options.isMobile
      ? MOBILE_HORIZONTAL_PADDING_PX
      : DESKTOP_HORIZONTAL_PADDING_PX) + panelWidth;
  const verticalPadding = options.isMobile
    ? MOBILE_VERTICAL_PADDING_PX
    : DESKTOP_VERTICAL_PADDING_PX;

  return {
    width: clamp(
      window.innerWidth - horizontalPadding,
      MIN_VIEWPORT_WIDTH_PX,
      MAX_VIEWPORT_WIDTH_PX,
    ),
    height: clamp(
      window.innerHeight - verticalPadding,
      MIN_VIEWPORT_HEIGHT_PX,
      MAX_VIEWPORT_HEIGHT_PX,
    ),
  };
}

export function useReaderViewport(options: UseReaderViewportOptions) {
  const { isMobile, isPanelOpen } = options;
  const [viewportAutoMode, setViewportAutoMode] = useState(
    options.initialAutoMode ?? true,
  );
  const [viewport, setViewport] = useState<ReaderViewport>(
    options.initialViewport ?? DEFAULT_VIEWPORT,
  );

  useEffect(() => {
    if (!viewportAutoMode) return;

    const onResize = () => {
      setViewport(getAutoViewport({ isMobile, isPanelOpen }));
    };

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isMobile, isPanelOpen, viewportAutoMode]);

  return {
    viewport,
    setViewport,
    viewportAutoMode,
    setViewportAutoMode,
  };
}
