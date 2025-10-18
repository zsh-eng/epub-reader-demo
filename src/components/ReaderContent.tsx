import { forwardRef, useEffect } from "react";

interface ReaderContentProps {
  content: string;
  chapterIndex: number;
  onHighlightClick?: (
    highlightId: string,
    position: { x: number; y: number },
  ) => void;
  activeHighlightId?: string | null;
}

const ReaderContent = forwardRef<HTMLDivElement, ReaderContentProps>(
  ({ content, chapterIndex, onHighlightClick, activeHighlightId }, ref) => {
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

      const handleClick = (event: Event) => {
        const target = event.target as HTMLElement;
        if (target.classList.contains("epub-highlight")) {
          const highlightId = target.getAttribute("data-highlight-id");
          if (highlightId && onHighlightClick) {
            // Get position of the clicked highlight element
            const rect = target.getBoundingClientRect();
            const position = {
              x: rect.left + rect.width / 2,
              y: rect.bottom + 5, // Position below the highlight
            };
            onHighlightClick(highlightId, position);
          }
        }
      };

      contentElement.addEventListener("mouseenter", handleMouseEnter, true);
      contentElement.addEventListener("mouseleave", handleMouseLeave, true);
      contentElement.addEventListener("click", handleClick, true);

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
        contentElement.removeEventListener("click", handleClick, true);
      };
    }, [ref, content, onHighlightClick]);

    // Update active highlight class when activeHighlightId changes
    useEffect(() => {
      const contentElement = typeof ref === "function" ? null : ref?.current;
      if (!contentElement) return;

      // Remove active class from all highlights
      const allHighlights = contentElement.querySelectorAll(".epub-highlight");
      allHighlights.forEach((el) => {
        el.classList.remove("epub-highlight-active");
      });

      // Add active class to the selected highlight
      if (activeHighlightId) {
        const activeHighlights = contentElement.querySelectorAll(
          `[data-highlight-id="${activeHighlightId}"]`,
        );
        activeHighlights.forEach((el) => {
          el.classList.add("epub-highlight-active");
        });
      }
    }, [ref, activeHighlightId, content]);

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
