import {
  CONTENT_WIDTH_VALUES,
  EPUB_LINK,
  FONT_STACKS,
  type ReaderSettings,
} from "@/types/reader.types";
import { forwardRef, useCallback } from "react";

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

    // Handle internal EPUB link clicks via React event
    const handleClick = useCallback(
      (event: React.MouseEvent) => {
        if (!onInternalLinkClick) return;

        const target = event.target as HTMLElement;

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

    return (
      <div
        key={chapterIndex}
        ref={ref}
        onClick={handleClick}
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
