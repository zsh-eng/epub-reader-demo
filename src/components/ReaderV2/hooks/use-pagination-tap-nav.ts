import { useEffect, useRef, type RefObject } from "react";

type TapZone = "left" | "center" | "right";
type TapNavigationAction = "prev" | "next" | "toggleChrome" | null;

interface UsePaginationTapNavOptions {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onNextSpread: () => void;
  onPrevSpread: () => void;
  onToggleChrome?: () => void;
  canGoNext: boolean;
  canGoPrev: boolean;
}

interface ResolveTapNavigationActionOptions {
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

export function resolveTapNavigationAction(
  options: ResolveTapNavigationActionOptions,
): TapNavigationAction {
  const { clientX, rect, target, isDefaultPrevented, canGoNext, canGoPrev } =
    options;

  if (isDefaultPrevented) return null;
  if (isInteractiveTapTarget(target)) return null;

  const zone = getHorizontalTapZone(clientX, rect);

  if (zone === "left") return canGoPrev ? "prev" : null;
  if (zone === "right") return canGoNext ? "next" : null;
  return "toggleChrome";
}

export function usePaginationTapNav(options: UsePaginationTapNavOptions) {
  const {
    containerRef,
    enabled,
    onNextSpread,
    onPrevSpread,
    onToggleChrome,
    canGoNext,
    canGoPrev,
  } = options;

  const nextSpreadRef = useRef(onNextSpread);
  const prevSpreadRef = useRef(onPrevSpread);
  const toggleChromeRef = useRef(onToggleChrome);
  const canGoNextRef = useRef(canGoNext);
  const canGoPrevRef = useRef(canGoPrev);
  const lastHandledTapRef = useRef<{ at: number; x: number } | null>(null);

  nextSpreadRef.current = onNextSpread;
  prevSpreadRef.current = onPrevSpread;
  toggleChromeRef.current = onToggleChrome;
  canGoNextRef.current = canGoNext;
  canGoPrevRef.current = canGoPrev;

  const container = containerRef.current;

  useEffect(() => {
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

    const navigateForTap = (
      clientX: number,
      target: EventTarget | null,
      isDefaultPrevented: boolean,
      preventDefault: () => void,
    ) => {
      const action = resolveTapNavigationAction({
        clientX,
        rect: container.getBoundingClientRect(),
        target,
        isDefaultPrevented,
        canGoNext: canGoNextRef.current,
        canGoPrev: canGoPrevRef.current,
      });

      if (!action) return false;

      preventDefault();
      if (action === "prev") {
        prevSpreadRef.current();
        return true;
      }
      if (action === "next") {
        nextSpreadRef.current();
        return true;
      }

      toggleChromeRef.current?.();
      return true;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const handled = navigateForTap(
        event.clientX,
        event.target,
        event.defaultPrevented,
        () => event.preventDefault(),
      );
      if (handled) markHandled(event.clientX);
    };

    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches.item(0);
      if (!touch) return;
      if (wasRecentlyHandled(touch.clientX)) return;

      const handled = navigateForTap(
        touch.clientX,
        event.target,
        event.defaultPrevented,
        () => event.preventDefault(),
      );
      if (handled) markHandled(touch.clientX);
    };

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (wasRecentlyHandled(event.clientX)) return;

      const handled = navigateForTap(
        event.clientX,
        event.target,
        event.defaultPrevented,
        () => event.preventDefault(),
      );
      if (handled) markHandled(event.clientX);
    };

    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("touchend", onTouchEnd);
    container.addEventListener("click", onClick);

    return () => {
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("click", onClick);
    };
  }, [container, enabled]);
}
