import { useEffect, useRef } from "react";

interface UsePaginationKeyboardNavOptions {
  onNextSpread: () => void;
  onPrevSpread: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

export function usePaginationKeyboardNav(
  options: UsePaginationKeyboardNavOptions,
) {
  const { onNextSpread, onPrevSpread } = options;
  const nextSpreadRef = useRef(onNextSpread);
  const prevSpreadRef = useRef(onPrevSpread);
  nextSpreadRef.current = onNextSpread;
  prevSpreadRef.current = onPrevSpread;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        prevSpreadRef.current();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        nextSpreadRef.current();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
