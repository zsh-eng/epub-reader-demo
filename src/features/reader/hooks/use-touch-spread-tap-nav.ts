import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { dispatchReaderTouchTapHandled } from "./reader-interaction-events";

type TapZone = "left" | "center" | "right";
type TapNavigationAction =
  | "prev"
  | "next"
  | "toggleChrome"
  | "hideChrome"
  | null;
type TouchPressSource = "pointer" | "touch";

interface UseTouchSpreadTapNavOptions {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onNextSpread: () => void;
  onPrevSpread: () => void;
  onShowChrome?: () => void;
  onHideChrome?: () => void;
  chromeVisible?: boolean;
  canGoNext: boolean;
  canGoPrev: boolean;
}

interface TouchPressState {
  source: TouchPressSource;
  id: number;
  startX: number;
  startY: number;
  startedAt: number;
  target: EventTarget | null;
  moved: boolean;
}

interface TouchTapCandidate {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startedAt: number;
  endedAt: number;
  moved: boolean;
}

interface ResolveTapNavigationActionOptions {
  chromeVisible?: boolean;
  clientX: number;
  rect: Pick<DOMRectReadOnly, "left" | "width">;
  target: EventTarget | null;
  isDefaultPrevented: boolean;
  canGoNext: boolean;
  canGoPrev: boolean;
}

const INTERACTIVE_TARGET_SELECTOR = [
  "[data-highlight-id]",
  "button",
  "[role='button']",
  "a[href]",
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[contenteditable='']",
].join(", ");

export const TOUCH_TAP_MOVE_TOLERANCE_PX = 10;
export const MAX_TOUCH_TAP_DURATION_MS = 450;
export const MAX_TOUCH_CHROME_GESTURE_DURATION_MS = 700;

function getTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

export function getHorizontalTapZone(
  clientX: number,
  rect: Pick<DOMRectReadOnly, "left" | "width">,
): TapZone {
  if (rect.width <= 0) return "center";

  const normalizedX = (clientX - rect.left) / rect.width;
  if (normalizedX < 1 / 3) return "left";
  if (normalizedX < 2 / 3) return "center";
  return "right";
}

export function isInteractiveTapTarget(target: EventTarget | null): boolean {
  const element = getTargetElement(target);
  if (!element) return false;

  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }

  return element.closest(INTERACTIVE_TARGET_SELECTOR) !== null;
}

export function hasExceededTouchTapMoveTolerance(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
): boolean {
  return (
    Math.hypot(clientX - startX, clientY - startY) > TOUCH_TAP_MOVE_TOLERANCE_PX
  );
}

export function isCleanTouchTap(candidate: TouchTapCandidate): boolean {
  if (candidate.moved) return false;
  if (candidate.endedAt - candidate.startedAt > MAX_TOUCH_TAP_DURATION_MS) {
    return false;
  }

  return !hasExceededTouchTapMoveTolerance(
    candidate.startX,
    candidate.startY,
    candidate.endX,
    candidate.endY,
  );
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

export function isReaderScrollGesture(candidate: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startedAt: number;
  endedAt: number;
  target: EventTarget | null;
  isDefaultPrevented: boolean;
}): boolean {
  if (candidate.isDefaultPrevented) return false;
  if (isInteractiveTapTarget(candidate.target)) return false;
  if (
    candidate.endedAt - candidate.startedAt >
    MAX_TOUCH_CHROME_GESTURE_DURATION_MS
  ) {
    return false;
  }

  const distanceX = Math.abs(candidate.endX - candidate.startX);
  const distanceY = Math.abs(candidate.endY - candidate.startY);

  return distanceY > TOUCH_TAP_MOVE_TOLERANCE_PX && distanceY > distanceX;
}

function clearDomSelectionSoon(): void {
  window.getSelection()?.removeAllRanges();
  window.setTimeout(() => window.getSelection()?.removeAllRanges(), 80);
  window.setTimeout(() => window.getSelection()?.removeAllRanges(), 240);
}

export function resolveTapNavigationAction(
  options: ResolveTapNavigationActionOptions,
): TapNavigationAction {
  const { clientX, rect, target, isDefaultPrevented, canGoNext, canGoPrev } =
    options;

  if (isDefaultPrevented) return null;
  if (isInteractiveTapTarget(target)) return null;
  if (options.chromeVisible) return "hideChrome";

  const zone = getHorizontalTapZone(clientX, rect);

  if (zone === "left") return canGoPrev ? "prev" : null;
  if (zone === "right") return canGoNext ? "next" : null;
  return "toggleChrome";
}

/**
 * Handles the exposed touch reading surface only.
 *
 * A clean tap dismisses visible chrome before any page navigation. Swipes and
 * long presses remain available to the swipe recognizer and native selection.
 */
export function useTouchSpreadTapNav(options: UseTouchSpreadTapNavOptions) {
  const {
    containerRef,
    enabled,
    onNextSpread,
    onPrevSpread,
    onShowChrome,
    onHideChrome,
    chromeVisible = false,
    canGoNext,
    canGoPrev,
  } = options;

  const pressRef = useRef<TouchPressState | null>(null);
  const lastHandledTapRef = useRef<{ at: number; x: number } | null>(null);

  // Native listeners keep their lifetime but use committed navigation state.
  const showChrome = useEffectEvent(() => onShowChrome?.());
  const navigateForTap = useEffectEvent(
    (
      clientX: number,
      target: EventTarget | null,
      isDefaultPrevented: boolean,
      preventDefault: () => void,
    ) => {
      const container = containerRef.current;
      if (!container) return false;
      const action = resolveTapNavigationAction({
        clientX,
        rect: container.getBoundingClientRect(),
        target,
        isDefaultPrevented,
        chromeVisible,
        canGoNext,
        canGoPrev,
      });
      if (!action) return false;
      preventDefault();
      if (action === "prev") onPrevSpread();
      else if (action === "next") onNextSpread();
      else if (action === "hideChrome") onHideChrome?.();
      else onShowChrome?.();
      return true;
    },
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const markHandled = (x: number) => {
      lastHandledTapRef.current = { at: Date.now(), x };
    };

    const wasRecentlyHandled = (x: number): boolean => {
      const last = lastHandledTapRef.current;
      if (!last) return false;

      const withinTimeWindow = Date.now() - last.at < 400;
      const withinDistanceWindow = Math.abs(last.x - x) <= 3;
      return withinTimeWindow && withinDistanceWindow;
    };

    const handleHandledTap = (clientX: number) => {
      markHandled(clientX);
      dispatchReaderTouchTapHandled();
      clearDomSelectionSoon();
    };

    const finishTouchPress = (
      press: TouchPressState,
      clientX: number,
      clientY: number,
      endTarget: EventTarget | null,
      isDefaultPrevented: boolean,
      preventDefault: () => void,
    ) => {
      const endedAt = Date.now();
      const isCleanTap = isCleanTouchTap({
        startX: press.startX,
        startY: press.startY,
        endX: clientX,
        endY: clientY,
        startedAt: press.startedAt,
        endedAt,
        moved: press.moved,
      });

      if (
        isReaderScrollGesture({
          startX: press.startX,
          startY: press.startY,
          endX: clientX,
          endY: clientY,
          startedAt: press.startedAt,
          endedAt,
          target: press.target ?? endTarget,
          isDefaultPrevented,
        }) &&
        !hasActiveTextSelection()
      ) {
        showChrome();
        return;
      }

      if (!isCleanTap || hasActiveTextSelection()) return;

      const handled = navigateForTap(
        clientX,
        press.target ?? endTarget,
        isDefaultPrevented,
        preventDefault,
      );
      if (handled) handleHandledTap(clientX);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      if (event.button !== 0) return;

      pressRef.current = {
        source: "pointer",
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: Date.now(),
        target: event.target,
        moved: false,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      const press = pressRef.current;
      if (
        !press ||
        press.source !== "pointer" ||
        press.id !== event.pointerId
      ) {
        return;
      }

      if (
        hasExceededTouchTapMoveTolerance(
          press.startX,
          press.startY,
          event.clientX,
          event.clientY,
        )
      ) {
        press.moved = true;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const press = pressRef.current;
      if (
        !press ||
        press.source !== "pointer" ||
        press.id !== event.pointerId
      ) {
        return;
      }

      pressRef.current = null;
      finishTouchPress(
        press,
        event.clientX,
        event.clientY,
        event.target,
        event.defaultPrevented,
        () => event.preventDefault(),
      );
    };

    const onPointerCancel = (event: PointerEvent) => {
      const press = pressRef.current;
      if (press && press.source === "pointer" && press.id === event.pointerId) {
        pressRef.current = null;
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      if (window.PointerEvent) return;
      if (event.touches.length !== 1) return;

      const touch = event.touches.item(0);
      if (!touch) return;

      pressRef.current = {
        source: "touch",
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        startedAt: Date.now(),
        target: event.target,
        moved: false,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const press = pressRef.current;
      if (!press || press.source !== "touch") return;

      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === press.id,
      );
      if (!touch) return;

      if (
        hasExceededTouchTapMoveTolerance(
          press.startX,
          press.startY,
          touch.clientX,
          touch.clientY,
        )
      ) {
        press.moved = true;
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (window.PointerEvent) return;
      const press = pressRef.current;
      if (!press || press.source !== "touch") return;

      const touch = event.changedTouches.item(0);
      if (!touch) return;
      if (touch.identifier !== press.id) return;
      pressRef.current = null;

      if (wasRecentlyHandled(touch.clientX)) return;

      finishTouchPress(
        press,
        touch.clientX,
        touch.clientY,
        event.target,
        event.defaultPrevented,
        () => event.preventDefault(),
      );
    };

    const onTouchCancel = () => {
      if (pressRef.current?.source === "touch") {
        pressRef.current = null;
      }
    };

    // A handled touch can still produce a compatibility click on Android.
    const onClick = (event: MouseEvent) => {
      if (event.detail === 0 || isInteractiveTapTarget(event.target)) return;
      if (!wasRecentlyHandled(event.clientX)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    container.addEventListener("click", onClick, true);
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerCancel);
    container.addEventListener("touchstart", onTouchStart);
    container.addEventListener("touchmove", onTouchMove);
    container.addEventListener("touchend", onTouchEnd);
    container.addEventListener("touchcancel", onTouchCancel);

    return () => {
      container.removeEventListener("click", onClick, true);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerCancel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [containerRef, enabled]);
}
