import type { CSSProperties, HTMLAttributes } from "react";

export const DESKTOP_CHROME_FADE_TRANSITION = {
  duration: 0.16,
  ease: [0.23, 1, 0.32, 1] as const,
};

/**
 * Shared interaction props for any visible reader chrome surface that should
 * keep the auto-hiding chrome open while hovered or focused.
 */
export type ReaderChromeSurfaceProps = Pick<
  HTMLAttributes<HTMLElement>,
  "onBlur" | "onFocus" | "onPointerEnter" | "onPointerLeave"
>;

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
