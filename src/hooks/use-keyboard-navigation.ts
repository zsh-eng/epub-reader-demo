import { useEffect } from "react";

export function useKeyboardNavigation(
  goToPreviousChapter: () => void,
  goToNextChapter: () => void,
): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPreviousChapter();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNextChapter();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToPreviousChapter, goToNextChapter]);
}
