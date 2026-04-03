import { useEffect, useRef } from "react";

interface UsePaginationKeyboardNavOptions {
  onNextPage: () => void;
  onPrevPage: () => void;
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
  const { onNextPage, onPrevPage } = options;
  const nextPageRef = useRef(onNextPage);
  const prevPageRef = useRef(onPrevPage);
  nextPageRef.current = onNextPage;
  prevPageRef.current = onPrevPage;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        prevPageRef.current();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        nextPageRef.current();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
