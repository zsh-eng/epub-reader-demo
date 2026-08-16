import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { useFileUrl } from "@/hooks/use-file-url";
import {
  useAllHighlightsQuery,
  type BookHighlightGroup,
} from "@/hooks/use-all-highlights-query";
import { formatHighlightTime } from "@/lib/date-utils";
import type { SyncedHighlight } from "@/lib/db";
import {
  BOOK_COVER_TILE_ID,
  BOOK_DETAILS_TILE_ID,
  computeJustifiedHighlightsMosaicLayout,
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
  LayoutGroup,
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  BookOpen,
  BookOpenText,
  Highlighter,
  Pin,
  PinOff,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "react-router-dom";

const MOSAIC_GAP = 12;
const MOSAIC_MAX_COLUMNS = 4;
const MOSAIC_MIN_CARD_WIDTH = 220;
const QUOTE_FONT = '400 18px "EB Garamond"';
const QUOTE_LINE_HEIGHT = 24;
const QUOTE_CARD_CHROME_HEIGHT = 62;
const QUOTE_CARD_MIN_HEIGHT = 96;
const BOOK_TITLE_MAX_FONT = '500 44px "EB Garamond"';
const BOOK_INDEX_PIN_STORAGE_KEY = "highlights-masonry-book-index-pinned";
const BOOK_INDEX_ACTIVE_LAYOUT_ID = "highlights-book-index-active";
const BOOK_INDEX_ACTIVE_TRANSITION = {
  type: "spring" as const,
  stiffness: 390,
  damping: 36,
  mass: 0.9,
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

  return Math.ceil(titleHeight + (group.book.author ? 132 : 96));
}

function PositionedTile({
  placement,
  children,
}: {
  placement: MosaicPlacement;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute top-0 left-0"
      style={{
        height: placement.height,
        width: placement.width,
        transform: `translate3d(${placement.left}px, ${placement.top}px, 0)`,
      }}
    >
      {children}
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
    </div>
  );
}

function BookCoverTile({ group }: { group: BookHighlightGroup }) {
  const { url: coverUrl } = useFileUrl(group.book.coverContentHash, "cover", {
    skip: !group.book.coverContentHash,
  });

  if (coverUrl) {
    return (
      <img
        src={coverUrl}
        alt={`Cover of ${group.book.title}`}
        className="h-full w-full rounded-r-lg rounded-l-sm object-cover shadow-xl"
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center rounded-r-lg rounded-l-sm border bg-secondary shadow-xl">
      <BookOpenText
        className="size-10 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="sr-only">No cover available for {group.book.title}</span>
    </div>
  );
}

function HighlightQuoteCard({ highlight }: { highlight: SyncedHighlight }) {
  return (
    <article
      className="relative h-full overflow-hidden rounded-xl border bg-card text-card-foreground"
      style={getHighlightAccentStyle(highlight.color)}
    >
      <div
        className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[var(--highlight-accent)]"
        aria-hidden="true"
      />
      <Link
        to={`/reader/${highlight.bookId}`}
        state={{
          scrollToHighlight: {
            spineItemId: highlight.spineItemId,
            highlightId: highlight.id,
          },
        }}
        className="group flex h-full flex-col px-5 py-4 outline-none transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.99]"
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
          <BookOpen
            className="ml-1 size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-focus-visible:opacity-70"
            aria-hidden="true"
          />
          <span className="sr-only">Open in reader</span>
        </footer>
      </Link>
    </article>
  );
}

function HighlightsMosaic({
  group,
  headingId,
  highlights,
}: {
  group: BookHighlightGroup;
  headingId: string;
  highlights: SyncedHighlight[];
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
    if (!fontReady || geometry.columnWidth === 0) return 210;

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
      return computeJustifiedHighlightsMosaicLayout(0, []);
    }

    const textWidth = geometry.columnWidth - 40;
    const measurements = highlights.flatMap((highlight) => {
      const prepared = preparedById.get(highlight.id);
      if (!prepared) return [];

      const textHeight = layout(prepared, textWidth, QUOTE_LINE_HEIGHT).height;
      return [
        {
          id: highlight.id,
          height: Math.max(
            QUOTE_CARD_MIN_HEIGHT,
            textHeight + QUOTE_CARD_CHROME_HEIGHT,
          ),
        },
      ];
    });

    return computeJustifiedHighlightsMosaicLayout(width, measurements, {
      gap: MOSAIC_GAP,
      maxColumnCount: MOSAIC_MAX_COLUMNS,
      minColumnWidth: MOSAIC_MIN_CARD_WIDTH,
      detailsHeight,
    });
  }, [
    detailsHeight,
    fontReady,
    geometry.columnWidth,
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
        <PositionedTile placement={detailsPlacement}>
          <BookDetailsTile
            group={group}
            headingId={headingId}
            visibleCount={highlights.length}
            titleFontSize={titleFontSize}
          />
        </PositionedTile>
      )}

      {coverPlacement && (
        <PositionedTile placement={coverPlacement}>
          <BookCoverTile group={group} />
        </PositionedTile>
      )}

      {highlights.map((highlight) => {
        const placement = placementById.get(highlight.id);
        if (!placement) return null;

        return (
          <PositionedTile key={highlight.id} placement={placement}>
            <HighlightQuoteCard highlight={highlight} />
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
    <div className="mt-3 flex justify-center">
      <div className="flex items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-sm">
        <span className="mr-1 text-[11px] text-muted-foreground">
          Highlight color
        </span>
        {HIGHLIGHT_COLORS.map(({ name }) => {
          const isSelected = selectedColors.includes(name);

          return (
            <button
              key={name}
              type="button"
              onClick={() => onToggle(name)}
              aria-label={`${isSelected ? "Hide" : "Show"} ${name} highlights`}
              aria-pressed={isSelected}
              className={cn(
                "size-6 rounded-full border-[3px] border-background bg-[var(--highlight-accent)] shadow-[0_0_0_1px_var(--muted-foreground)] transition-[transform,opacity,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.94]",
                !isSelected && "opacity-30 shadow-none",
              )}
              style={getHighlightAccentStyle(name)}
            />
          );
        })}
      </div>
    </div>
  );
}

function HighlightsSearch({
  value,
  onChange,
  selectedColors,
  onToggleColor,
}: {
  value: string;
  onChange: (value: string) => void;
  selectedColors: HighlightColor[];
  onToggleColor: (color: HighlightColor) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
      <div className="relative mx-auto w-full max-w-xl">
        <Search
          className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search all highlights…"
          aria-label="Search all highlights"
          className="h-12 bg-card pr-13 pl-11 shadow-md backdrop-blur-xl dark:bg-card/95"
        />
        <CollapsibleTrigger
          aria-label="Filter highlights"
          className="absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none transition-[transform,color,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] data-[panel-open]:bg-secondary data-[panel-open]:text-foreground"
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ColorFilters
          selectedColors={selectedColors}
          onToggle={onToggleColor}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function HighlightsMasonry() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isBookIndexPinned, setIsBookIndexPinned] = useState(
    () => localStorage.getItem(BOOK_INDEX_PIN_STORAGE_KEY) === "true",
  );
  const [selectedColors, setSelectedColors] = useState<HighlightColor[]>(() =>
    HIGHLIGHT_COLORS.map(({ name }) => name),
  );
  const { scrollYProgress } = useScroll();
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
            ? selectedColors.length === HIGHLIGHT_COLORS.length
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

  useEffect(() => {
    localStorage.setItem(
      BOOK_INDEX_PIN_STORAGE_KEY,
      isBookIndexPinned ? "true" : "false",
    );
  }, [isBookIndexPinned]);

  const handleToggleColor = (color: HighlightColor) => {
    setSelectedColors((current) =>
      current.includes(color)
        ? current.filter((selected) => selected !== color)
        : [...current, color],
    );
  };

  return (
    <div className="min-h-svh bg-background text-foreground">
      <section className="px-4 pt-10 pb-5 text-center md:pt-14 md:pb-7">
        <h1 className="font-serif text-5xl font-medium leading-none tracking-tight md:text-6xl">
          Highlights
        </h1>
        {!isLoading && groups.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            {totalHighlightCount} highlights across {groups.length}{" "}
            {groups.length === 1 ? "book" : "books"}
          </p>
        )}
      </section>

      <div className="sticky top-3 z-30 isolate mx-auto w-full max-w-xl px-4">
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
          selectedColors={selectedColors}
          onToggleColor={handleToggleColor}
        />
      </div>
      {bookIndexGroups.length > 0 && (
        <div className="mx-auto max-w-[1600px] px-4">
          <MobileBookIndex
            groups={bookIndexGroups}
            activeBookId={activeBookId}
            onNavigate={setActiveBookId}
          />
        </div>
      )}

      <main className="mx-auto w-full max-w-[1600px] px-4 pt-4 pb-20 md:px-6 xl:px-8">
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
              isBookIndexPinned &&
                "gap-8 lg:grid-cols-[minmax(0,1fr)_248px] xl:gap-10",
            )}
          >
            <div
              className={cn(
                "min-w-0",
                visibleGroups.length > 0 && "pb-[calc(100svh-8rem)]",
              )}
            >
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
                        "scroll-mt-44 lg:scroll-mt-28",
                        index > 0 && "mt-16 border-t pt-14",
                      )}
                    >
                      <HighlightsMosaic
                        group={group}
                        headingId={headingId}
                        highlights={highlights}
                      />
                    </section>
                  );
                })
              ) : (
                <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
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
                onNavigate={setActiveBookId}
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
          onNavigate={setActiveBookId}
          onPin={() => setIsBookIndexPinned(true)}
          scrollProgress={scrollYProgress}
        />
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 hidden h-24 lg:block"
      >
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/35 to-transparent" />
        <div className="absolute inset-0 backdrop-blur-md [mask-image:linear-gradient(to_top,black_0%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_top,black_0%,transparent_100%)]" />
      </div>
    </div>
  );
}
