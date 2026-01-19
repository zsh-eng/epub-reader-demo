import {
  CONTENT_WIDTH_VALUES,
  EPUB_LINK,
  FONT_STACKS,
  type ReaderSettings,
} from "@/types/reader.types";
import { forwardRef, useCallback, useEffect, useRef } from "react";

interface ReaderContentProps {
  content: string;
  chapterIndex: number;
  title?: string;
  settings?: ReaderSettings;
  /** Callback for internal EPUB link clicks */
  onInternalLinkClick?: (href: string, fragment?: string) => void;
}

/**
 * ReaderContent renders the EPUB chapter content with styling.
 *
 * Highlight rendering and interaction is handled externally via the
 * useHighlighter hook in the parent component.
 */
const ReaderContent = forwardRef<HTMLDivElement, ReaderContentProps>(
  ({ content, chapterIndex, settings, onInternalLinkClick }, ref) => {
    const style = settings
      ? {
          fontSize: `${settings.fontSize}%`,
          lineHeight: settings.lineHeight,
          fontFamily: FONT_STACKS[settings.fontFamily],
          textAlign: settings.textAlign,
          maxWidth: CONTENT_WIDTH_VALUES[settings.contentWidth],
        }
      : undefined;

    // Internal ref for attaching event listeners
    const internalRef = useRef<HTMLDivElement>(null);

    // Combine refs: forward to parent and keep internal ref for event handling
    const setRefs = useCallback(
      (element: HTMLDivElement | null) => {
        (internalRef as React.RefObject<HTMLDivElement | null>).current =
          element;
        if (typeof ref === "function") {
          ref(element);
        } else if (ref) {
          ref.current = element;
        }
      },
      [ref],
    );

    // Handle internal EPUB link clicks
    const handleInternalLinkClick = useCallback(
      (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!onInternalLinkClick) return;

        // Find the closest anchor element with epub-link attribute
        const linkElement = target.closest(
          `[${EPUB_LINK.linkAttribute}]`,
        ) as HTMLElement | null;
        if (!linkElement) return;

        event.preventDefault();
        event.stopPropagation();

        const href = linkElement.getAttribute(EPUB_LINK.hrefAttribute) || "";
        const fragment =
          linkElement.getAttribute(EPUB_LINK.fragmentAttribute) || undefined;

        onInternalLinkClick(href, fragment);
      },
      [onInternalLinkClick],
    );

    // Attach internal link click handler
    useEffect(() => {
      const contentElement = internalRef.current;
      if (!contentElement) return;

      contentElement.addEventListener("click", handleInternalLinkClick, true);

      return () => {
        contentElement.removeEventListener(
          "click",
          handleInternalLinkClick,
          true,
        );
      };
    }, [handleInternalLinkClick]);

    return (
      <div
        key={chapterIndex}
        ref={setRefs}
        className="reader-content mx-auto px-6 pt-12 pb-24 sm:px-8 sm:pb-16 md:px-12 md:pb-20 transition-all duration-300 ease-in-out"
        style={style}
      >
        <div dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    );
  },
);

ReaderContent.displayName = "ReaderContent";

export default ReaderContent;
