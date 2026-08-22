import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { MobileBackToLibrary } from "@/components/ui/mobile-back-to-library";
import { useSpringPressAnimation } from "@/components/ui/spring-press";
import { useFileUrl } from "@/hooks/use-file-url";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useAllHighlightsQuery,
  type BookHighlightGroup,
} from "@/hooks/use-all-highlights-query";
import { formatHighlightTime } from "@/lib/date-utils";
import type { SyncedHighlight } from "@/lib/db";
import {
  ALL_HIGHLIGHT_COLORS,
  toggleHighlightColorSelection,
} from "@/lib/highlight-filter-selection";
import {
  BOOK_COVER_TILE_ID,
  BOOK_DETAILS_TILE_ID,
  computeHighlightsBentoLayout,
  getHighlightsMosaicGeometry,
  type MosaicPlacement,
} from "@/lib/highlights-masonry-layout";
import {
  HIGHLIGHT_COLORS,
  type AnnotationColor,
  type HighlightColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import { layout, prepare, type PreparedText } from "@chenglou/pretext";
import {
  AnimatePresence,
  LayoutGroup,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  ArrowRight,
  BookOpen,
  BookOpenText,
  Check,
  Copy,
  Ellipsis,
  Highlighter,
  Pin,
  PinOff,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

const MOSAIC_GAP = 12;
const MOSAIC_MAX_COLUMNS = 4;
const MOSAIC_MIN_CARD_WIDTH = 220;
const QUOTE_FONT = '400 18px "EB Garamond"';
const QUOTE_LINE_HEIGHT = 24;
const QUOTE_CARD_CHROME_HEIGHT = 62;
const QUOTE_CARD_MIN_HEIGHT = 96;
const WIDE_QUOTE_MIN_LINES = 7;
const BOOK_TITLE_MAX_FONT = '500 44px "EB Garamond"';
const BOOK_INDEX_PIN_STORAGE_KEY = "highlights-masonry-book-index-pinned";
const BOOK_INDEX_ACTIVE_LAYOUT_ID = "highlights-book-index-active";
const BOOK_INDEX_ACTIVE_TRANSITION = {
  type: "spring" as const,
  stiffness: 390,
  damping: 36,
  mass: 0.9,
};
const BOOK_PROGRESS_NAVIGATION_TRANSITION = {
  duration: 0.25,
  ease: [0.77, 0, 0.175, 1] as const,
};
const TILE_ENTRANCE_TRANSITION = {
  duration: 0.24,
  ease: [0.23, 1, 0.32, 1] as const,
};

const highlightAccentValues: Record<AnnotationColor, string> = {
  yellow: "var(--yellow-primary, var(--yellow-secondary))",
  green: "var(--green-primary, var(--green-secondary))",
  blue: "var(--blue-primary, var(--blue-secondary))",
  magenta: "var(--magenta-primary, var(--magenta-secondary))",
  invisible: "var(--muted-foreground)",
};

type HighlightAccentStyle = CSSProperties & {
  "--highlight-accent": string;
};

function getHighlightAccentStyle(color: AnnotationColor): HighlightAccentStyle {
  return { "--highlight-accent": highlightAccentValues[color] };
}

function getStableNumber(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function getTileEntrance(key: string) {
  const hash = getStableNumber(key);
  const offsets = [
    { x: -14, y: 10 },
    { x: 12, y: 14 },
    { x: -8, y: 16 },
    { x: 14, y: -6 },
  ];

  return {
    ...offsets[hash % offsets.length],
    delay: (hash % 6) * 0.035,
  };
}

function useElementWidth() {
  const elementRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const updateWidth = (nextWidth: number) => {
      setWidth(Math.floor(nextWidth));
    };

    updateWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return { elementRef, width };
}

function useSearchStickyState() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsCompact(!entry.isIntersecting),
      { rootMargin: "-12px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(anchor);

    return () => observer.disconnect();
  }, []);

  return { anchorRef, isCompact };
}

/**
 * Prepares quote text only after the display fonts are available. Pretext can
 * then recalculate card heights on resize without reading layout from the DOM.
 */
function usePreparedHighlights(highlights: SyncedHighlight[]) {
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      document.fonts.load(QUOTE_FONT),
      document.fonts.load(BOOK_TITLE_MAX_FONT),
    ]).then(() => {
      if (!cancelled) setFontReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const preparedById = useMemo(() => {
    const prepared = new Map<string, PreparedText>();
    if (!fontReady) return prepared;

    for (const highlight of highlights) {
      prepared.set(
        highlight.id,
        prepare(`“ ${highlight.selectedText}`, QUOTE_FONT),
      );
    }
    return prepared;
  }, [fontReady, highlights]);

  return { fontReady, preparedById };
}

function getBookTitleFontSize(containerWidth: number) {
  return Math.max(30, Math.min(44, containerWidth * 0.03));
}

function getBookDetailsHeight({
  group,
  columnWidth,
  fontSize,
}: {
  group: BookHighlightGroup;
  columnWidth: number;
  fontSize: number;
}) {
  const lineHeight = fontSize * 0.96;
  const preparedTitle = prepare(
    group.book.title,
    `500 ${fontSize}px "EB Garamond"`,
  );
  const titleHeight = layout(
    preparedTitle,
    Math.max(1, columnWidth - 20),
    lineHeight,
  ).height;

  return Math.ceil(titleHeight + (group.book.author ? 180 : 144));
}

function PositionedTile({
  placement,
  entranceKey,
  children,
}: {
  placement: MosaicPlacement;
  entranceKey: string;
  children: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const entrance = useMemo(() => getTileEntrance(entranceKey), [entranceKey]);

  return (
    <div
      className="absolute top-0 left-0"
      style={{
        height: placement.height,
        width: placement.width,
        transform: `translate3d(${placement.left}px, ${placement.top}px, 0)`,
      }}
    >
      <motion.div
        className="h-full"
        initial={
          reducedMotion
            ? { opacity: 0 }
            : {
                opacity: 0,
                transform: `translate3d(${entrance.x}px, ${entrance.y}px, 0) scale(0.97)`,
              }
        }
        animate={{
          opacity: 1,
          transform: "translate3d(0px, 0px, 0) scale(1)",
        }}
        transition={{
          ...TILE_ENTRANCE_TRANSITION,
          delay: reducedMotion ? 0 : entrance.delay,
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}

function getBookSectionId(bookId: string) {
  return `highlights-book-${bookId}`;
}

function getBookHeadingId(bookId: string) {
  return `highlights-book-heading-${bookId}`;
}

function useActiveBookId(bookIds: string[]) {
  const [activeBookId, setActiveBookId] = useState(bookIds[0] ?? "");

  useEffect(() => {
    const fallbackBookId = bookIds[0] ?? "";
    setActiveBookId((current) =>
      bookIds.includes(current) ? current : fallbackBookId,
    );

    if (bookIds.length === 0 || typeof IntersectionObserver === "undefined") {
      return;
    }

    const sections = bookIds.flatMap((bookId) => {
      const section = document.getElementById(getBookSectionId(bookId));
      return section ? [section] : [];
    });
    const visibleSectionIds = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            visibleSectionIds.add(entry.target.id);
          } else {
            visibleSectionIds.delete(entry.target.id);
          }
        });
        const visibleSections = sections
          .filter((section) => visibleSectionIds.has(section.id))
          .sort(
            (left, right) =>
              left.getBoundingClientRect().top -
              right.getBoundingClientRect().top,
          );
        const firstVisibleSection = visibleSections[0];
        if (!firstVisibleSection) return;

        setActiveBookId(firstVisibleSection.id.replace("highlights-book-", ""));
      },
      { rootMargin: "-96px 0px -68% 0px", threshold: 0 },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [bookIds]);

  return { activeBookId, setActiveBookId };
}

/**
 * Tracks manual scrolling without latency. An instant anchor jump temporarily
 * takes control and interpolates the visible rail to the new document progress.
 */
function useBookNavigationProgress(scrollProgress: MotionValue<number>) {
  const reducedMotion = useReducedMotion() ?? false;
  const displayedProgress = useMotionValue(scrollProgress.get());
  const navigationPendingRef = useRef(false);
  const navigationFrameRef = useRef(0);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);

  useEffect(() => {
    const unsubscribe = scrollProgress.on("change", (latestProgress) => {
      if (navigationPendingRef.current || animationRef.current) return;
      displayedProgress.set(latestProgress);
    });

    return () => {
      unsubscribe();
      window.cancelAnimationFrame(navigationFrameRef.current);
      animationRef.current?.stop();
    };
  }, [displayedProgress, scrollProgress]);

  const animateAfterInstantNavigation = useCallback(() => {
    window.cancelAnimationFrame(navigationFrameRef.current);
    animationRef.current?.stop();
    animationRef.current = null;
    navigationPendingRef.current = true;

    navigationFrameRef.current = window.requestAnimationFrame(() => {
      const targetProgress = scrollProgress.get();
      if (reducedMotion) {
        displayedProgress.set(targetProgress);
        navigationPendingRef.current = false;
        return;
      }

      const animation = animate(
        displayedProgress,
        targetProgress,
        BOOK_PROGRESS_NAVIGATION_TRANSITION,
      );
      animationRef.current = animation;
      navigationPendingRef.current = false;
      void animation.then(() => {
        if (animationRef.current !== animation) return;
        animationRef.current = null;
        displayedProgress.set(scrollProgress.get());
      });
    });
  }, [displayedProgress, reducedMotion, scrollProgress]);

  return { displayedProgress, animateAfterInstantNavigation };
}

function BookIndexItem({
  className,
  group,
  isActive,
  layoutId,
  onNavigate,
  reducedMotion,
}: {
  className?: string;
  group: BookHighlightGroup;
  isActive: boolean;
  layoutId: string;
  onNavigate: () => void;
  reducedMotion: boolean;
}) {
  const { url: coverUrl } = useFileUrl(group.book.coverContentHash, "cover", {
    skip: !group.book.coverContentHash,
  });
  const highlightCount = group.highlights.length;

  // Keep rows in the nav's shared stacking context. Otherwise the target row's
  // DOM order can lift the moving selection marker above rows that it crosses.
  return (
    <a
      href={`#${getBookSectionId(group.book.id)}`}
      onClick={onNavigate}
      aria-current={isActive ? "location" : undefined}
      className={cn(
        "relative flex min-w-0 items-center gap-2.5 rounded-xl p-2 text-left outline-none transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]",
        className,
      )}
    >
      {isActive && (
        <motion.span
          layoutId={layoutId}
          aria-hidden="true"
          initial={false}
          transition={
            reducedMotion ? { duration: 0 } : BOOK_INDEX_ACTIVE_TRANSITION
          }
          className="pointer-events-none absolute inset-0 z-0 rounded-xl bg-secondary"
        >
          <span className="absolute top-3 bottom-3 left-0 w-0.5 rounded-full bg-foreground/70" />
        </motion.span>
      )}
      <span className="relative z-10 aspect-2/3 w-11 shrink-0 overflow-hidden rounded-r-md rounded-l-xs shadow-md">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center border bg-secondary">
            <BookOpenText
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
          </span>
        )}
      </span>
      <span className="relative z-10 min-w-0 flex-1">
        <span className="line-clamp-2 font-serif text-base font-medium leading-[1.05]">
          {group.book.title}
        </span>
        {group.book.author && (
          <span className="mt-1 block truncate text-[11px] text-muted-foreground">
            {group.book.author}
          </span>
        )}
        <span className="mt-1.5 block text-[11px] text-muted-foreground">
          {highlightCount} {highlightCount === 1 ? "highlight" : "highlights"}
        </span>
      </span>
    </a>
  );
}

function BookIndexPanel({
  className,
  style,
  groups,
  activeBookId,
  isPinned,
  onNavigate,
  onPinChange,
}: {
  className?: string;
  style?: CSSProperties;
  groups: BookHighlightGroup[];
  activeBookId: string;
  isPinned: boolean;
  onNavigate: (bookId: string) => void;
  onPinChange: (isPinned: boolean) => void;
}) {
  const layoutGroupId = useId();
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <aside
      style={style}
      className={cn(
        "max-h-[calc(100svh-7rem)] flex-col overflow-hidden rounded-2xl border bg-card p-2 shadow-xl",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 pt-1 pb-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate font-serif text-lg font-medium">
            In this page
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {groups.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onPinChange(!isPinned)}
          aria-label={isPinned ? "Unpin book index" : "Pin book index"}
          aria-pressed={isPinned}
          title={isPinned ? "Unpin book index" : "Pin book index"}
          className={cn(
            "grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]",
            isPinned && "bg-secondary text-foreground",
          )}
        >
          {isPinned ? (
            <PinOff className="size-3.5" aria-hidden="true" />
          ) : (
            <Pin className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
      <LayoutGroup id={layoutGroupId}>
        <nav
          aria-label="Books on this highlights page"
          className="relative isolate min-h-0 overflow-y-auto pr-1 pb-1"
        >
          {groups.map((group) => (
            <BookIndexItem
              key={group.book.id}
              group={group}
              isActive={group.book.id === activeBookId}
              layoutId={BOOK_INDEX_ACTIVE_LAYOUT_ID}
              onNavigate={() => onNavigate(group.book.id)}
              reducedMotion={reducedMotion}
            />
          ))}
        </nav>
      </LayoutGroup>
    </aside>
  );
}

function MobileBookIndex({
  groups,
  activeBookId,
  onNavigate,
}: {
  groups: BookHighlightGroup[];
  activeBookId: string;
  onNavigate: (bookId: string) => void;
}) {
  const layoutGroupId = useId();
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <LayoutGroup id={layoutGroupId}>
      <nav
        aria-label="Books on this highlights page"
        className="relative isolate -mx-4 mt-3 grid auto-cols-[210px] grid-flow-col gap-2 overflow-x-auto px-4 pb-1 lg:hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {groups.map((group) => (
          <BookIndexItem
            key={group.book.id}
            group={group}
            isActive={group.book.id === activeBookId}
            layoutId={BOOK_INDEX_ACTIVE_LAYOUT_ID}
            onNavigate={() => onNavigate(group.book.id)}
            reducedMotion={reducedMotion}
            className="border bg-card/80 shadow-sm"
          />
        ))}
      </nav>
    </LayoutGroup>
  );
}

function FloatingBookIndex({
  groups,
  activeBookId,
  onNavigate,
  onPin,
  scrollProgress,
}: {
  groups: BookHighlightGroup[];
  activeBookId: string;
  onNavigate: (bookId: string) => void;
  onPin: () => void;
  scrollProgress: MotionValue<number>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const closeTimerRef = useRef(0);
  const progressTransform = useTransform(
    scrollProgress,
    (value) => `translate3d(0, 0, 0) scaleY(${value})`,
  );

  useEffect(() => {
    return () => window.clearTimeout(closeTimerRef.current);
  }, []);

  const showPanel = () => {
    window.clearTimeout(closeTimerRef.current);
    setIsOpen(true);
  };

  const schedulePanelClose = () => {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setIsOpen(false), 100);
  };

  return (
    <div
      onMouseEnter={showPanel}
      onMouseLeave={schedulePanelClose}
      className={cn(
        "fixed top-[calc((100svh-min(64svh,560px))/2)] right-0 z-40 hidden h-[min(64svh,560px)] w-[292px] lg:pointer-fine:block",
        isOpen ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      <div
        onMouseEnter={showPanel}
        title="Books on this page"
        className="pointer-events-auto absolute inset-y-0 right-0 w-24 cursor-default"
      >
        <div className="absolute inset-y-3 right-3 w-1 overflow-hidden rounded-full bg-border">
          <motion.div
            className="h-full origin-top rounded-full bg-foreground/55"
            style={{ transform: progressTransform }}
          />
        </div>
      </div>

      <BookIndexPanel
        groups={groups}
        activeBookId={activeBookId}
        isPinned={false}
        onNavigate={onNavigate}
        onPinChange={onPin}
        className={cn(
          "absolute inset-y-0 right-6 flex w-64 origin-right will-change-[transform,opacity]",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={{
          transform:
            isOpen || prefersReducedMotion
              ? "translate3d(0, 0, 0)"
              : "translate3d(16px, 0, 0)",
          transitionDuration: isOpen ? "180ms" : "150ms",
          transitionProperty: prefersReducedMotion
            ? "opacity"
            : "transform, opacity",
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      />
    </div>
  );
}

function BookDetailsTile({
  group,
  headingId,
  visibleCount,
  titleFontSize,
}: {
  group: BookHighlightGroup;
  headingId: string;
  visibleCount: number;
  titleFontSize: number;
}) {
  const totalCount = group.highlights.length;
  const countLabel =
    visibleCount === totalCount
      ? `${totalCount} ${totalCount === 1 ? "highlight" : "highlights"}`
      : `${visibleCount} of ${totalCount} highlights`;

  return (
    <div className="flex h-full flex-col justify-start py-4 pr-4 pl-1">
      <span className="mb-3 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
        Book
      </span>
      <h2
        id={headingId}
        className="font-serif font-medium tracking-[-0.035em] text-balance"
        style={{ fontSize: titleFontSize, lineHeight: 0.96 }}
      >
        {group.book.title}
      </h2>
      {group.book.author && (
        <p className="mt-4 font-serif text-base text-muted-foreground italic md:text-lg">
          {group.book.author}
        </p>
      )}
      <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-green-primary" />
        <span>{countLabel}</span>
      </div>
      <Link
        to={`/reader/${group.book.id}`}
        className="mt-6 inline-flex w-fit items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium outline-none transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
      >
        Continue reading
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function BookCoverTile({
  group,
  coverWidth,
}: {
  group: BookHighlightGroup;
  coverWidth: number;
}) {
  const { url: coverUrl } = useFileUrl(group.book.coverContentHash, "cover", {
    skip: !group.book.coverContentHash,
  });

  if (coverUrl) {
    return (
      <div className="flex h-full items-center justify-center">
        <img
          src={coverUrl}
          alt={`Cover of ${group.book.title}`}
          className="aspect-2/3 max-h-full rounded-r-lg rounded-l-sm object-cover shadow-xl"
          style={{ width: coverWidth }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div
        className="flex aspect-2/3 max-h-full items-center justify-center rounded-r-lg rounded-l-sm border bg-secondary shadow-xl"
        style={{ width: coverWidth }}
      >
        <BookOpenText
          className="size-10 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="sr-only">
          No cover available for {group.book.title}
        </span>
      </div>
    </div>
  );
}

function HighlightQuoteCard({
  highlight,
  isMobile,
  onCopy,
  onOpenActions,
  onOpenBook,
}: {
  highlight: SyncedHighlight;
  isMobile: boolean;
  onCopy: (highlight: SyncedHighlight) => void;
  onOpenActions: (highlight: SyncedHighlight) => void;
  onOpenBook: (highlight: SyncedHighlight) => void;
}) {
  const card = (
    <article
      className="relative h-full overflow-hidden rounded-xl border bg-card text-card-foreground"
      style={getHighlightAccentStyle(highlight.color)}
    >
      <div
        className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[var(--highlight-accent)]"
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={() =>
          isMobile ? onOpenActions(highlight) : onCopy(highlight)
        }
        aria-label={
          isMobile ? "Show highlight actions" : "Copy highlight to clipboard"
        }
        className="group flex h-full w-full cursor-pointer flex-col px-5 py-4 text-left outline-none transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.99] md:cursor-copy"
      >
        <blockquote className="m-0 break-words font-serif text-[18px] leading-6">
          <span
            className="mr-1 text-[25px] leading-0 text-[var(--highlight-accent)]"
            aria-hidden="true"
          >
            “
          </span>
          {highlight.selectedText}
        </blockquote>
        <footer className="mt-auto flex h-7 shrink-0 items-end justify-end gap-1.5 text-[11px] text-muted-foreground">
          <span
            className="size-1.5 rounded-full bg-[var(--highlight-accent)]"
            aria-hidden="true"
          />
          <time dateTime={new Date(highlight.createdAt).toISOString()}>
            {formatHighlightTime(highlight.createdAt)}
          </time>
          {isMobile ? (
            <Ellipsis className="ml-1 size-3.5 opacity-60" aria-hidden="true" />
          ) : (
            <Copy
              className="ml-1 size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-focus-visible:opacity-70"
              aria-hidden="true"
            />
          )}
          <span className="sr-only">
            {isMobile ? "Show actions" : "Copy highlight"}
          </span>
        </footer>
      </button>
    </article>
  );

  if (isMobile) return card;

  return (
    <ContextMenu>
      <ContextMenuTrigger render={card} />
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => onCopy(highlight)}>
          <Copy className="size-4" aria-hidden="true" />
          Copy highlight
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onOpenBook(highlight)}>
          <BookOpen className="size-4" aria-hidden="true" />
          Open in book
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function HighlightActionsSheet({
  highlight,
  onClose,
  onCopy,
  onOpenBook,
}: {
  highlight: SyncedHighlight | null;
  onClose: () => void;
  onCopy: (highlight: SyncedHighlight) => Promise<boolean>;
  onOpenBook: (highlight: SyncedHighlight) => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const copyPress = useSpringPressAnimation();
  const openBookPress = useSpringPressAnimation();
  const [isCopied, setIsCopied] = useState(false);
  const resetTimerRef = useRef(0);

  useEffect(() => {
    setIsCopied(false);
    window.clearTimeout(resetTimerRef.current);
  }, [highlight]);

  useEffect(() => {
    return () => window.clearTimeout(resetTimerRef.current);
  }, []);

  const handleCopy = async () => {
    if (!highlight) return;

    const didCopy = await onCopy(highlight);
    if (!didCopy) return;

    setIsCopied(true);
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setIsCopied(false), 1600);
  };

  return (
    <BottomSheet
      open={highlight !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Highlight actions"
      panelClassName="max-w-md"
    >
      <div
        className="px-4 pt-2"
        style={{
          paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
        }}
      >
        {highlight && (
          <blockquote
            className="mb-3 line-clamp-4 rounded-2xl border bg-secondary/25 px-4 py-3 font-serif text-base leading-6"
            style={getHighlightAccentStyle(highlight.color)}
          >
            <span
              className="mr-1 text-xl text-[var(--highlight-accent)]"
              aria-hidden="true"
            >
              “
            </span>
            {highlight.selectedText}
          </blockquote>
        )}

        <div className="grid gap-2">
          <motion.button
            type="button"
            onClick={() => void handleCopy()}
            className="flex h-14 items-center gap-3 rounded-2xl border bg-card px-4 text-left font-medium outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
            {...copyPress}
          >
            <span className="relative grid size-8 place-items-center rounded-full bg-secondary">
              <AnimatePresence initial={false} mode="wait">
                <motion.span
                  key={isCopied ? "copied" : "copy"}
                  className="absolute grid place-items-center"
                  initial={
                    reducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, transform: "scale(0.92)" }
                  }
                  animate={{ opacity: 1, transform: "scale(1)" }}
                  exit={
                    reducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, transform: "scale(0.92)" }
                  }
                  transition={{
                    duration: reducedMotion ? 0.1 : 0.18,
                    ease: [0.23, 1, 0.32, 1],
                  }}
                >
                  {isCopied ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                </motion.span>
              </AnimatePresence>
            </span>
            <span aria-live="polite">
              {isCopied ? "Copied" : "Copy highlight"}
            </span>
          </motion.button>
          <motion.button
            type="button"
            onClick={() => {
              if (highlight) onOpenBook(highlight);
            }}
            className="flex h-14 items-center gap-3 rounded-2xl border bg-card px-4 text-left font-medium outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
            {...openBookPress}
          >
            <span className="grid size-8 place-items-center rounded-full bg-secondary">
              <BookOpen className="size-4" aria-hidden="true" />
            </span>
            Open in book
          </motion.button>
        </div>
      </div>
    </BottomSheet>
  );
}

function HighlightsMosaic({
  group,
  headingId,
  highlights,
  isMobile,
  onCopy,
  onOpenActions,
  onOpenBook,
}: {
  group: BookHighlightGroup;
  headingId: string;
  highlights: SyncedHighlight[];
  isMobile: boolean;
  onCopy: (highlight: SyncedHighlight) => void;
  onOpenActions: (highlight: SyncedHighlight) => void;
  onOpenBook: (highlight: SyncedHighlight) => void;
}) {
  const { elementRef, width } = useElementWidth();
  const { fontReady, preparedById } = usePreparedHighlights(group.highlights);
  const geometry = useMemo(
    () =>
      getHighlightsMosaicGeometry(width, {
        gap: MOSAIC_GAP,
        maxColumnCount: MOSAIC_MAX_COLUMNS,
        minColumnWidth: MOSAIC_MIN_CARD_WIDTH,
      }),
    [width],
  );
  const titleFontSize = getBookTitleFontSize(width);
  const detailsHeight = useMemo(() => {
    if (!fontReady || geometry.columnWidth === 0) return 250;

    return getBookDetailsHeight({
      group,
      columnWidth: geometry.columnWidth,
      fontSize: titleFontSize,
    });
  }, [fontReady, geometry.columnWidth, group, titleFontSize]);

  const mosaic = useMemo(() => {
    const isReady =
      width > 0 && fontReady && preparedById.size === group.highlights.length;
    if (!isReady) {
      return computeHighlightsBentoLayout(0, []);
    }

    const textWidth = Math.max(1, geometry.columnWidth - 40);
    const wideTextWidth = Math.max(
      1,
      geometry.columnWidth * 2 + MOSAIC_GAP - 40,
    );
    const measurements = highlights.flatMap((highlight) => {
      const prepared = preparedById.get(highlight.id);
      if (!prepared) return [];

      const textHeight = layout(prepared, textWidth, QUOTE_LINE_HEIGHT).height;
      const shouldUseWideCard =
        geometry.columnCount > 1 &&
        textHeight >= QUOTE_LINE_HEIGHT * WIDE_QUOTE_MIN_LINES;
      const wideTextHeight = shouldUseWideCard
        ? layout(prepared, wideTextWidth, QUOTE_LINE_HEIGHT).height
        : textHeight;

      return [
        {
          id: highlight.id,
          height: Math.max(
            QUOTE_CARD_MIN_HEIGHT,
            textHeight + QUOTE_CARD_CHROME_HEIGHT,
          ),
          wideHeight: Math.max(
            QUOTE_CARD_MIN_HEIGHT,
            wideTextHeight + QUOTE_CARD_CHROME_HEIGHT,
          ),
          preferredColumnSpan: shouldUseWideCard ? (2 as const) : (1 as const),
        },
      ];
    });

    return computeHighlightsBentoLayout(width, measurements, {
      gap: MOSAIC_GAP,
      maxColumnCount: MOSAIC_MAX_COLUMNS,
      minColumnWidth: MOSAIC_MIN_CARD_WIDTH,
      detailsHeight,
      layoutSeed: getStableNumber(group.book.id),
    });
  }, [
    detailsHeight,
    fontReady,
    geometry.columnCount,
    geometry.columnWidth,
    group.book.id,
    group.highlights.length,
    highlights,
    preparedById,
    width,
  ]);

  const placementById = useMemo(
    () =>
      new Map(mosaic.placements.map((placement) => [placement.id, placement])),
    [mosaic.placements],
  );
  const detailsPlacement = placementById.get(BOOK_DETAILS_TILE_ID);
  const coverPlacement = placementById.get(BOOK_COVER_TILE_ID);

  return (
    <div
      ref={elementRef}
      className="relative"
      style={{ height: mosaic.height || 520 }}
    >
      {detailsPlacement && (
        <PositionedTile
          placement={detailsPlacement}
          entranceKey={`${group.book.id}-${BOOK_DETAILS_TILE_ID}`}
        >
          <BookDetailsTile
            group={group}
            headingId={headingId}
            visibleCount={highlights.length}
            titleFontSize={titleFontSize}
          />
        </PositionedTile>
      )}

      {coverPlacement && (
        <PositionedTile
          placement={coverPlacement}
          entranceKey={`${group.book.id}-${BOOK_COVER_TILE_ID}`}
        >
          <BookCoverTile group={group} coverWidth={mosaic.coverWidth} />
        </PositionedTile>
      )}

      {highlights.map((highlight) => {
        const placement = placementById.get(highlight.id);
        if (!placement) return null;

        return (
          <PositionedTile
            key={highlight.id}
            placement={placement}
            entranceKey={highlight.id}
          >
            <HighlightQuoteCard
              highlight={highlight}
              isMobile={isMobile}
              onCopy={onCopy}
              onOpenActions={onOpenActions}
              onOpenBook={onOpenBook}
            />
          </PositionedTile>
        );
      })}
    </div>
  );
}

function ColorFilters({
  selectedColors,
  onToggle,
}: {
  selectedColors: HighlightColor[];
  onToggle: (color: HighlightColor) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by highlight color"
      className="flex items-center gap-1.5"
    >
      {HIGHLIGHT_COLORS.map(({ name }) => {
        const isSelected = selectedColors.includes(name);
        const allColorsSelected =
          selectedColors.length === ALL_HIGHLIGHT_COLORS.length;
        const actionLabel = allColorsSelected
          ? `Show only ${name} highlights`
          : isSelected && selectedColors.length === 1
            ? "Show all highlight colors"
            : `${isSelected ? "Hide" : "Show"} ${name} highlights`;

        return (
          <button
            key={name}
            type="button"
            onClick={() => onToggle(name)}
            aria-label={actionLabel}
            aria-pressed={isSelected}
            title={actionLabel}
            className={cn(
              "size-6 rounded-full border-2 border-background bg-[var(--highlight-accent)] shadow-[0_0_0_1px_var(--muted-foreground)] transition-[transform,opacity,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94]",
              !isSelected && "opacity-25 shadow-none",
            )}
            style={getHighlightAccentStyle(name)}
          />
        );
      })}
    </div>
  );
}

function HighlightsSearch({
  value,
  onChange,
  isCompact,
  selectedColors,
  onToggleColor,
}: {
  value: string;
  onChange: (value: string) => void;
  isCompact: boolean;
  selectedColors: HighlightColor[];
  onToggleColor: (color: HighlightColor) => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <motion.div
      className="relative mx-auto w-full max-w-2xl origin-top"
      initial={false}
      animate={{
        transform:
          isCompact && !reducedMotion
            ? "translate3d(0, 0, 0) scale(0.94)"
            : "translate3d(0, 0, 0) scale(1)",
      }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
    >
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search all highlights…"
        aria-label="Search all highlights"
        className={cn(
          "h-14 appearance-none bg-card pl-10 shadow-md backdrop-blur-xl dark:bg-card/95 [&::-webkit-search-cancel-button]:hidden",
          value ? "pr-44 md:pr-48" : "pr-36 md:pr-40",
        )}
      />
      <div className="absolute top-1/2 right-4 flex -translate-y-1/2 items-center gap-2.5">
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear highlight search"
            title="Clear search"
            className="grid size-7 place-items-center rounded-full text-muted-foreground outline-none transition-[color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94]"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
        <ColorFilters
          selectedColors={selectedColors}
          onToggle={onToggleColor}
        />
      </div>
    </motion.div>
  );
}

export function HighlightsMasonry() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedHighlight, setSelectedHighlight] =
    useState<SyncedHighlight | null>(null);
  const [isBookIndexPinned, setIsBookIndexPinned] = useState(
    () => localStorage.getItem(BOOK_INDEX_PIN_STORAGE_KEY) === "true",
  );
  const [selectedColors, setSelectedColors] = useState<HighlightColor[]>(() => [
    ...ALL_HIGHLIGHT_COLORS,
  ]);
  const { scrollYProgress } = useScroll();
  const { anchorRef: searchAnchorRef, isCompact: isSearchCompact } =
    useSearchStickyState();
  const { displayedProgress, animateAfterInstantNavigation } =
    useBookNavigationProgress(scrollYProgress);
  const { data: groups = [], isLoading } = useAllHighlightsQuery();
  const visibleGroups = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return groups.flatMap((group) => {
      const bookMatches =
        normalizedQuery.length > 0 &&
        (group.book.title.toLowerCase().includes(normalizedQuery) ||
          group.book.author.toLowerCase().includes(normalizedQuery));
      const highlights = group.highlights.filter((highlight) => {
        const matchesColor =
          highlight.color === "invisible"
            ? selectedColors.length === ALL_HIGHLIGHT_COLORS.length
            : selectedColors.includes(highlight.color);
        const matchesQuery =
          normalizedQuery.length === 0 ||
          bookMatches ||
          highlight.selectedText.toLowerCase().includes(normalizedQuery);
        return matchesColor && matchesQuery;
      });

      return highlights.length > 0 ? [{ group, highlights }] : [];
    });
  }, [groups, searchQuery, selectedColors]);
  const visibleBookIds = useMemo(
    () => visibleGroups.map(({ group }) => group.book.id),
    [visibleGroups],
  );
  const bookIndexGroups = useMemo(
    () =>
      visibleGroups.map(({ group, highlights }) => ({
        ...group,
        highlights,
      })),
    [visibleGroups],
  );
  const { activeBookId, setActiveBookId } = useActiveBookId(visibleBookIds);
  const totalHighlightCount = useMemo(
    () => groups.reduce((total, group) => total + group.highlights.length, 0),
    [groups],
  );
  const hasNoMatches =
    !isLoading && groups.length > 0 && visibleGroups.length === 0;

  useEffect(() => {
    localStorage.setItem(
      BOOK_INDEX_PIN_STORAGE_KEY,
      isBookIndexPinned ? "true" : "false",
    );
  }, [isBookIndexPinned]);

  useEffect(() => {
    if (!isMobile) setSelectedHighlight(null);
  }, [isMobile]);

  const handleToggleColor = (color: HighlightColor) => {
    setSelectedColors((current) =>
      toggleHighlightColorSelection(current, color),
    );
  };

  const handleBookNavigate = useCallback(
    (bookId: string) => {
      setActiveBookId(bookId);
      animateAfterInstantNavigation();
    },
    [animateAfterInstantNavigation, setActiveBookId],
  );

  const copyHighlight = useCallback(
    async (highlight: SyncedHighlight, announceWithToast: boolean) => {
      try {
        await navigator.clipboard.writeText(highlight.selectedText);
        if (announceWithToast) {
          toast.success("Highlight copied", {
            id: "highlight-copied",
            duration: 2200,
          });
        }
        return true;
      } catch {
        toast.error("Could not copy highlight", {
          id: "highlight-copy-error",
        });
        return false;
      }
    },
    [],
  );

  const handleDesktopCopy = useCallback(
    (highlight: SyncedHighlight) => {
      void copyHighlight(highlight, true);
    },
    [copyHighlight],
  );

  const handleMobileCopy = useCallback(
    (highlight: SyncedHighlight) => copyHighlight(highlight, false),
    [copyHighlight],
  );

  const handleOpenBook = useCallback(
    (highlight: SyncedHighlight) => {
      setSelectedHighlight(null);
      navigate(`/reader/${highlight.bookId}`, {
        state: {
          scrollToHighlight: {
            spineItemId: highlight.spineItemId,
            highlightId: highlight.id,
          },
        },
      });
    },
    [navigate],
  );

  return (
    <div
      className={cn(
        "flex min-h-svh flex-col bg-background text-foreground",
        hasNoMatches && "h-svh overflow-hidden",
      )}
    >
      <section className="px-4 pt-10 pb-5 text-center md:pt-14 md:pb-7">
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-3 md:block">
          <MobileBackToLibrary />
          <h1 className="font-serif text-5xl font-medium leading-none tracking-tight md:text-6xl">
            Highlights
          </h1>
          <div className="size-8 md:hidden" aria-hidden="true" />
        </div>
        {!isLoading && groups.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            {totalHighlightCount} highlights across {groups.length}{" "}
            {groups.length === 1 ? "book" : "books"}
          </p>
        )}
      </section>

      <div ref={searchAnchorRef} className="h-px shrink-0" aria-hidden="true" />
      <div className="sticky top-3 z-30 isolate mx-auto w-full max-w-2xl shrink-0 px-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-4 -top-3 -bottom-5 -z-10"
        >
          <div className="absolute inset-0 bg-gradient-to-b from-background/50 via-background/15 to-transparent" />
          <div className="highlights-search-scroll-blur absolute inset-0 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]" />
        </div>
        <HighlightsSearch
          value={searchQuery}
          onChange={setSearchQuery}
          isCompact={isSearchCompact}
          selectedColors={selectedColors}
          onToggleColor={handleToggleColor}
        />
      </div>
      {bookIndexGroups.length > 0 && (
        <div className="mx-auto max-w-[1600px] px-4">
          <MobileBookIndex
            groups={bookIndexGroups}
            activeBookId={activeBookId}
            onNavigate={handleBookNavigate}
          />
        </div>
      )}

      <main className="mx-auto min-h-0 w-full max-w-[1600px] flex-1 px-4 pt-4 pb-4 md:px-6 md:pb-6 xl:px-8">
        {isLoading ? (
          <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
            Loading highlights…
          </div>
        ) : groups.length === 0 ? (
          <div className="flex min-h-80 flex-col items-center justify-center text-center">
            <div className="mb-5 rounded-full bg-secondary p-5">
              <Highlighter
                className="size-9 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
            <h2 className="font-serif text-3xl font-medium">
              No highlights yet
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Start reading and highlighting text to see it here.
            </p>
          </div>
        ) : (
          <div
            className={cn(
              "grid lg:items-start",
              hasNoMatches && "h-full",
              isBookIndexPinned &&
                visibleGroups.length > 0 &&
                "gap-8 lg:grid-cols-[minmax(0,1fr)_248px] xl:gap-10",
            )}
          >
            <div className={cn("min-w-0", hasNoMatches && "h-full")}>
              {visibleGroups.length > 0 ? (
                visibleGroups.map(({ group, highlights }, index) => {
                  const sectionId = getBookSectionId(group.book.id);
                  const headingId = getBookHeadingId(group.book.id);

                  return (
                    <section
                      key={group.book.id}
                      id={sectionId}
                      aria-labelledby={headingId}
                      className={cn(
                        "scroll-mt-44 last:min-h-[calc(100svh-11rem)] lg:scroll-mt-28 lg:last:min-h-[calc(100svh-7rem)]",
                        index > 0 && "mt-16 border-t pt-14",
                      )}
                    >
                      <HighlightsMosaic
                        group={group}
                        headingId={headingId}
                        highlights={highlights}
                        isMobile={isMobile}
                        onCopy={handleDesktopCopy}
                        onOpenActions={setSelectedHighlight}
                        onOpenBook={handleOpenBook}
                      />
                    </section>
                  );
                })
              ) : (
                <div className="flex h-full min-h-0 w-full flex-col items-center justify-center rounded-2xl border border-dashed text-center">
                  <Search
                    className="mb-4 size-7 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <h2 className="font-serif text-2xl font-medium">
                    No matching highlights
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Change the search text or color filters.
                  </p>
                </div>
              )}
            </div>
            {visibleGroups.length > 0 && isBookIndexPinned && (
              <BookIndexPanel
                groups={bookIndexGroups}
                activeBookId={activeBookId}
                isPinned
                onNavigate={handleBookNavigate}
                onPinChange={setIsBookIndexPinned}
                className="sticky top-[calc((100svh-min(64svh,560px))/2)] hidden h-[min(64svh,560px)] self-start lg:flex"
              />
            )}
          </div>
        )}
      </main>
      {!isLoading && !isBookIndexPinned && bookIndexGroups.length > 0 && (
        <FloatingBookIndex
          groups={bookIndexGroups}
          activeBookId={activeBookId}
          onNavigate={handleBookNavigate}
          onPin={() => setIsBookIndexPinned(true)}
          scrollProgress={displayedProgress}
        />
      )}
      {isMobile && (
        <HighlightActionsSheet
          highlight={selectedHighlight}
          onClose={() => setSelectedHighlight(null)}
          onCopy={handleMobileCopy}
          onOpenBook={handleOpenBook}
        />
      )}
    </div>
  );
}
