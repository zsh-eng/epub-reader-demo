import type { CSSProperties, HTMLAttributes } from "react";

/**
 * Shared interaction props for any visible reader chrome surface that should
 * keep the auto-hiding chrome open while hovered or focused.
 */
export type ReaderChromeSurfaceProps = Pick<
  HTMLAttributes<HTMLElement>,
  "onBlur" | "onFocus" | "onPointerEnter" | "onPointerLeave"
>;

/**
 * Transparent touch chrome layer rendered above the spread but below visible
 * chrome surfaces. Its only job is to dismiss chrome before taps can reach the
 * reading spread.
 */
export type ReaderChromeDismissLayerProps = Pick<
  HTMLAttributes<HTMLDivElement>,
  "onClick" | "onPointerDown" | "onPointerMove" | "onPointerUp"
> & {
  "aria-hidden": true;
  "data-reader-chrome-dismiss-layer": true;
};

/**
 * Props for invisible hover rails rendered outside the reading surface in
 * hover-capable environments.
 */
export type ReaderChromeRailProps = Pick<
  HTMLAttributes<HTMLDivElement>,
  "onPointerEnter" | "onPointerLeave"
> & {
  "aria-hidden": true;
  "data-reader-chrome-rail": "top" | "bottom";
  style: CSSProperties;
};
