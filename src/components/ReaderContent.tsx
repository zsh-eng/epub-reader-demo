import {
  CONTENT_WIDTH_VALUES,
  EPUB_HIGHLIGHT_ACTIVE_CLASS,
  EPUB_HIGHLIGHT_CLASS,
  EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
  EPUB_HIGHLIGHT_GROUP_HOVER_CLASS,
  EPUB_LINK,
  FONT_STACKS,
  type ReaderSettings,
} from "@/types/reader.types";
import {
  createHighlightInteractionManager,
  type HighlightInteractionManager,
} from "@zsh-eng/text-highlighter";
import { forwardRef, useCallback, useEffect, useRef } from "react";

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
  /** Callback for internal EPUB link clicks */
  onInternalLinkClick?: (href: string, fragment?: string) => void;
}

const ReaderContent = forwardRef<HTMLDivElement, ReaderContentProps>(
  (
    {
      content,
      chapterIndex,
      // title,
      onHighlightClick,
      activeHighlightId,
      settings,
      onInternalLinkClick,
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

    // Store manager ref for active highlight updates
    const managerRef = useRef<HighlightInteractionManager | null>(null);

    // Set up highlight interaction manager
    useEffect(() => {
      const contentElement = typeof ref === "function" ? null : ref?.current;
      if (!contentElement) return;

      const manager = createHighlightInteractionManager(contentElement, {
        highlightClass: EPUB_HIGHLIGHT_CLASS,
        idAttribute: EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
        hoverClass: EPUB_HIGHLIGHT_GROUP_HOVER_CLASS,
        activeClass: EPUB_HIGHLIGHT_ACTIVE_CLASS,
        onHighlightClick: onHighlightClick,
      });

      managerRef.current = manager;

      return () => {
        manager.destroy();
        managerRef.current = null;
      };
    }, [ref, content, onHighlightClick]);

    // Update active highlight when it changes
    useEffect(() => {
      managerRef.current?.setActiveHighlight(activeHighlightId ?? null);
    }, [activeHighlightId]);

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

    // Internal links require a special handler for us to navigate properly
    useEffect(() => {
      const contentElement = typeof ref === "function" ? null : ref?.current;
      if (!contentElement) return;

      contentElement.addEventListener("click", handleInternalLinkClick, true);

      return () => {
        contentElement.removeEventListener(
          "click",
          handleInternalLinkClick,
          true,
        );
      };
    }, [ref, handleInternalLinkClick]);

    return (
      <div
        key={chapterIndex}
        ref={ref}
        className="reader-content mx-auto px-6 pt-12 pb-24 sm:px-8 sm:pb-16 md:px-12 md:pb-20 transition-all duration-300 ease-in-out"
        style={style}
      >
        {/*<header className="text-center select-none flex h-96 flex-col justify-center gap-0">
          {title && (
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold text-foreground tracking-tight text-balance leading-tight">
              {title}
            </h1>
          )}
          <hr className="w-16 border-t-2 border-muted-foreground/20 mx-auto mt-0" />
        </header>*/}
        <div dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    );
  },
);

ReaderContent.displayName = "ReaderContent";

export default ReaderContent;
