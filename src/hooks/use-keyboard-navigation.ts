import { useEffect } from "react";

export function useKeyboardNavigation(
  goToPreviousChapter: () => void,
  goToNextChapter: () => void,
  goBack?: () => void,
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
      } else if (event.key === "Escape" && goBack) {
        event.preventDefault();
        goBack();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToPreviousChapter, goToNextChapter, goBack]);
}
