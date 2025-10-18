import { forwardRef, useEffect } from "react";

interface ReaderContentProps {
  content: string;
  chapterIndex: number;
}

const ReaderContent = forwardRef<HTMLDivElement, ReaderContentProps>(
  ({ content, chapterIndex }, ref) => {
    useEffect(() => {
      const contentElement = typeof ref === "function" ? null : ref?.current;
      if (!contentElement) return;

      const handleMouseEnter = (event: Event) => {
        const target = event.target as HTMLElement;
        if (target.classList.contains("epub-highlight")) {
          const highlightId = target.getAttribute("data-highlight-id");
          if (highlightId) {
            const relatedHighlights = contentElement.querySelectorAll(
              `[data-highlight-id="${highlightId}"]`,
            );
            relatedHighlights.forEach((el) => {
              el.classList.add("epub-highlight-group-hover");
            });
          }
        }
      };

      const handleMouseLeave = (event: Event) => {
        const target = event.target as HTMLElement;
        if (target.classList.contains("epub-highlight")) {
          const highlightId = target.getAttribute("data-highlight-id");
          if (highlightId) {
            const relatedHighlights = contentElement.querySelectorAll(
              `[data-highlight-id="${highlightId}"]`,
            );
            relatedHighlights.forEach((el) => {
              el.classList.remove("epub-highlight-group-hover");
            });
          }
        }
      };

      contentElement.addEventListener("mouseenter", handleMouseEnter, true);
      contentElement.addEventListener("mouseleave", handleMouseLeave, true);

      return () => {
        contentElement.removeEventListener(
          "mouseenter",
          handleMouseEnter,
          true,
        );
        contentElement.removeEventListener(
          "mouseleave",
          handleMouseLeave,
          true,
        );
      };
    }, [ref, content]);

    return (
      <div
        key={chapterIndex}
        ref={ref}
        className="reader-content max-w-[80ch] mx-auto px-6 py-8 sm:px-8 md:px-12"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  },
);

ReaderContent.displayName = "ReaderContent";

export default ReaderContent;
