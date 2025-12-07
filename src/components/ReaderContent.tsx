import {
  CONTENT_WIDTH_VALUES,
  EPUB_HIGHLIGHT_CLASS,
  EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
  EPUB_HIGHLIGHT_GROUP_HOVER_CLASS,
  FONT_STACKS,
  type ReaderSettings,
} from "@/types/reader.types";
import { forwardRef, useEffect } from "react";

interface ReaderContentProps {
  content: string;
  chapterIndex: number;
  title?: string;
  onHighlightClick?: (
    highlightId: string,
    position: { x: number; y: number },
  ) => void;
  activeHighlightId?: string | null;
  settings?: ReaderSettings;
}

const ReaderContent = forwardRef<HTMLDivElement, ReaderContentProps>(
  (
    {
      content,
      chapterIndex,
      title,
      onHighlightClick,
      activeHighlightId,
      settings,
    },
    ref,
  ) => {
    const style = settings
      ? {
          fontSize: `${settings.fontSize}%`,
          lineHeight: settings.lineHeight,
          fontFamily: FONT_STACKS[settings.fontFamily],
          textAlign: settings.textAlign,
          maxWidth: CONTENT_WIDTH_VALUES[settings.contentWidth],
        }
      : undefined;

    useEffect(() => {
      const contentElement = typeof ref === "function" ? null : ref?.current;
      if (!contentElement) return;

      const handleMouseEnter = (event: Event) => {
        const target = event.target as HTMLElement;
        if (!target.classList.contains(EPUB_HIGHLIGHT_CLASS)) return;

        const highlightId = target.getAttribute(EPUB_HIGHLIGHT_DATA_ATTRIBUTE);
        if (!highlightId) return;

        const relatedHighlights = contentElement.querySelectorAll(
          `[${EPUB_HIGHLIGHT_DATA_ATTRIBUTE}="${highlightId}"]`,
        );
        relatedHighlights.forEach((el) => {
          el.classList.add(EPUB_HIGHLIGHT_GROUP_HOVER_CLASS);
        });
      };

      const handleMouseLeave = (event: Event) => {
        const target = event.target as HTMLElement;
        if (!target.classList.contains(EPUB_HIGHLIGHT_CLASS)) return;

        const highlightId = target.getAttribute(EPUB_HIGHLIGHT_DATA_ATTRIBUTE);
        if (!highlightId) return;

        const relatedHighlights = contentElement.querySelectorAll(
          `[${EPUB_HIGHLIGHT_DATA_ATTRIBUTE}="${highlightId}"]`,
        );
        relatedHighlights.forEach((el) => {
          el.classList.remove(EPUB_HIGHLIGHT_GROUP_HOVER_CLASS);
        });
      };

      const handleClick = (event: Event) => {
        const target = event.target as HTMLElement;
        if (!target.classList.contains(EPUB_HIGHLIGHT_CLASS)) return;

        const highlightId = target.getAttribute(EPUB_HIGHLIGHT_DATA_ATTRIBUTE);
        if (!highlightId || !onHighlightClick) return;

        // Get position of the clicked highlight element
        const rect = target.getBoundingClientRect();
        const position = {
          x: rect.left + rect.width / 2,
          y: rect.bottom + 5, // Position below the highlight
        };
        onHighlightClick(highlightId, position);
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
        className="reader-content mx-auto px-6 pb-12 sm:px-8 sm:pb-16 md:px-12 md:pb-20 transition-all duration-300 ease-in-out"
        style={style}
      >
        <header className="text-center select-none flex h-96 flex-col justify-center gap-0">
          {title && (
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold text-foreground tracking-tight text-balance leading-tight">
              {title}
            </h1>
          )}
          <hr className="w-16 border-t-2 border-muted-foreground/20 mx-auto mt-0" />
        </header>
        <div dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    );
  },
);

ReaderContent.displayName = "ReaderContent";

export default ReaderContent;
