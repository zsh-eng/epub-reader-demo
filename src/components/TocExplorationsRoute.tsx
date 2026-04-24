import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, BookOpen } from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Link } from "react-router-dom";

type Chapter = {
  id: string;
  number: number;
  title: string;
  page: number;
};

type Part = {
  id: string;
  number: number;
  title: string;
  startPage: number;
  endPage: number;
  chapters: Chapter[];
};

type ChapterWithPart = Chapter & {
  part: Part;
};

/**
 * Shared sample data keeps the two editorial treatments comparable while the
 * route stays a design lab rather than a production reader screen.
 */
const sampleParts: Part[] = [
  {
    id: "part-1",
    number: 1,
    title: "Thresholds",
    startPage: 1,
    endPage: 68,
    chapters: [
      { id: "ch-1", number: 1, title: "Salt in the Air", page: 1 },
      { id: "ch-2", number: 2, title: "The Glass Lobby", page: 14 },
      { id: "ch-3", number: 3, title: "Borrowed Light", page: 29 },
      { id: "ch-4", number: 4, title: "Small Mechanical Gods", page: 46 },
      { id: "ch-5", number: 5, title: "The Unfinished Map", page: 58 },
    ],
  },
  {
    id: "part-2",
    number: 2,
    title: "Transit",
    startPage: 69,
    endPage: 156,
    chapters: [
      { id: "ch-6", number: 6, title: "Night Trains", page: 69 },
      { id: "ch-7", number: 7, title: "Stations of Dust", page: 84 },
      { id: "ch-8", number: 8, title: "Portrait of a Courier", page: 97 },
      { id: "ch-9", number: 9, title: "Every Locked Gate", page: 118 },
      { id: "ch-10", number: 10, title: "The Narrow Sea", page: 139 },
    ],
  },
  {
    id: "part-3",
    number: 3,
    title: "Marginalia",
    startPage: 157,
    endPage: 292,
    chapters: [
      { id: "ch-11", number: 11, title: "Ink Under the Fingernails", page: 157 },
      { id: "ch-12", number: 12, title: "Rooms We Kept", page: 176 },
      { id: "ch-13", number: 13, title: "The Folded Letter", page: 191 },
      { id: "ch-14", number: 14, title: "What the Archivist Heard", page: 208 },
      { id: "ch-15", number: 15, title: "Index of Abandoned Names", page: 224 },
      { id: "ch-16", number: 16, title: "Blue Thread", page: 241 },
      { id: "ch-17", number: 17, title: "Quiet Inventory", page: 257 },
      { id: "ch-18", number: 18, title: "The River Draft", page: 274 },
      { id: "ch-19", number: 19, title: "Dust Ledger", page: 286 },
    ],
  },
  {
    id: "part-4",
    number: 4,
    title: "The Fourth Ledger",
    startPage: 293,
    endPage: 404,
    chapters: [
      { id: "ch-20", number: 20, title: "Part IV: False Starts", page: 293 },
      { id: "ch-21", number: 21, title: "The Well Under the City", page: 309 },
      { id: "ch-22", number: 22, title: "Candle Taxonomy", page: 327 },
      { id: "ch-23", number: 23, title: "The Hidden Stair", page: 348 },
      { id: "ch-24", number: 24, title: "A Map with Teeth", page: 361 },
      { id: "ch-25", number: 25, title: "Seventh Key", page: 374 },
      { id: "ch-26", number: 26, title: "The Inventory Breaks", page: 388 },
      { id: "ch-27", number: 27, title: "The Lantern Room", page: 398 },
    ],
  },
  {
    id: "part-5",
    number: 5,
    title: "Afterlight",
    startPage: 405,
    endPage: 472,
    chapters: [
      { id: "ch-28", number: 28, title: "Ash Between Pages", page: 405 },
      { id: "ch-29", number: 29, title: "The Return Passage", page: 423 },
      { id: "ch-30", number: 30, title: "What We Keep", page: 444 },
      { id: "ch-31", number: 31, title: "Postscript for the Living", page: 462 },
    ],
  },
];

const DEFAULT_ACTIVE_CHAPTER_ID = "ch-23";

const CHAPTER_ACTIVE_TRANSITION = {
  type: "spring" as const,
  stiffness: 390,
  damping: 36,
  mass: 0.9,
};

const allChapters: ChapterWithPart[] = sampleParts.flatMap((part) =>
  part.chapters.map((chapter) => ({
    ...chapter,
    part,
  })),
);

function DeviceFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[25rem] rounded-[2rem] border border-border/70 bg-card/90 p-3 shadow-[0_32px_80px_-32px_var(--border)] backdrop-blur-sm">
      <div className="overflow-hidden rounded-[1.6rem] border border-border/70 bg-background shadow-inner">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-border/70 px-4 py-3">
          <div aria-hidden="true" />
          <div className="text-center text-[0.7rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {title}
          </div>
          <div aria-hidden="true" />
        </div>
        <div className="h-[44rem] overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function MetaChip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border/70 bg-background/80 px-3 py-1 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
        {eyebrow}
      </p>
      <div className="space-y-2">
        <h2 className="text-3xl font-semibold leading-tight text-foreground">
          {title}
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function ChapterRow({
  chapter,
  activeChapterId,
  dense = false,
  layoutId,
  onSelect,
  reducedMotion,
  currentRef,
}: {
  chapter: Chapter;
  activeChapterId: string;
  dense?: boolean;
  layoutId: string;
  onSelect: (chapterId: string) => void;
  reducedMotion: boolean;
  currentRef?: Ref<HTMLButtonElement>;
}) {
  const current = chapter.id === activeChapterId;

  return (
    <motion.button
      ref={current ? currentRef : undefined}
      type="button"
      className={cn(
        "relative isolate min-h-12 w-full rounded-xl px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        dense ? "py-3" : "py-3.5",
      )}
      aria-current={current ? "true" : undefined}
      onClick={() => onSelect(chapter.id)}
      whileTap={reducedMotion ? undefined : { scale: 0.985 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.12 }}
    >
      {current ? (
        <motion.span
          layoutId={layoutId}
          aria-hidden="true"
          className="absolute inset-0 z-0 rounded-xl bg-accent/45"
          initial={false}
          transition={
            reducedMotion ? { duration: 0 } : CHAPTER_ACTIVE_TRANSITION
          }
        >
          <span className="absolute bottom-3 left-0 top-3 w-0.5 rounded-full bg-foreground/70" />
        </motion.span>
      ) : null}
      <div className="relative z-10 grid grid-cols-[2.25rem_minmax(0,1fr)_2.75rem] items-baseline gap-3 pl-1">
        <span
          className={cn(
            "text-right font-numeric text-xs tabular-nums text-muted-foreground",
            current && "font-medium text-foreground",
          )}
        >
          {chapter.number}
        </span>
        <div className="flex min-w-0 items-baseline gap-3">
          <span
            className={cn(
              "min-w-0 text-[0.95rem] font-medium leading-snug text-foreground",
              current && "font-semibold",
            )}
          >
            {chapter.title}
          </span>
          <span
            className={cn(
              "mb-1 min-w-6 flex-1 border-b border-dotted border-border/60",
              current && "border-transparent",
            )}
          />
        </div>
        <span
          className={cn(
            "text-right font-numeric text-sm tabular-nums text-muted-foreground",
            current && "font-medium text-foreground",
          )}
        >
          {chapter.page}
        </span>
      </div>
    </motion.button>
  );
}

function useCurrentRowScrollPosition(activeChapterId: string) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const currentRowRef = useRef<HTMLButtonElement | null>(null);

  // Keep the exploration preview opened around the active chapter without a
  // separate current-position summary competing with the contents list.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const currentRow = currentRowRef.current;

    if (!container || !currentRow) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const rowRect = currentRow.getBoundingClientRect();
    container.scrollTop += rowRect.top - containerRect.top - 16;
  }, [activeChapterId]);

  return { scrollContainerRef, currentRowRef };
}

function GroupedEditorialPreview({
  activeChapterId,
  onSelectChapter,
}: {
  activeChapterId: string;
  onSelectChapter: (chapterId: string) => void;
}) {
  const layoutGroupId = useId();
  const reducedMotion = useReducedMotion() ?? false;
  const { scrollContainerRef, currentRowRef } =
    useCurrentRowScrollPosition(activeChapterId);

  return (
    <LayoutGroup id={layoutGroupId}>
      <DeviceFrame title="Contents">
        <div ref={scrollContainerRef} className="h-full overflow-y-auto px-4 py-5">
          <div className="space-y-6">
            {sampleParts.map((part) => (
              <section key={part.id} className="space-y-3">
                <div className="flex items-center justify-between gap-4 border-b border-border/70 pb-2">
                  <h4 className="text-[0.68rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                    {part.title}
                  </h4>
                  <p className="font-numeric text-sm tabular-nums text-muted-foreground">
                    {part.startPage}-{part.endPage}
                  </p>
                </div>

                <div className="space-y-1">
                  {part.chapters.map((chapter) => (
                    <ChapterRow
                      key={chapter.id}
                      activeChapterId={activeChapterId}
                      chapter={chapter}
                      layoutId="grouped-editorial-active-chapter"
                      onSelect={onSelectChapter}
                      reducedMotion={reducedMotion}
                      currentRef={currentRowRef}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </DeviceFrame>
    </LayoutGroup>
  );
}

function FlatEditorialPreview({
  activeChapterId,
  onSelectChapter,
}: {
  activeChapterId: string;
  onSelectChapter: (chapterId: string) => void;
}) {
  const layoutGroupId = useId();
  const reducedMotion = useReducedMotion() ?? false;
  const { scrollContainerRef, currentRowRef } =
    useCurrentRowScrollPosition(activeChapterId);

  return (
    <LayoutGroup id={layoutGroupId}>
      <DeviceFrame title="Contents">
        <div ref={scrollContainerRef} className="h-full overflow-y-auto px-4 py-5">
          <div className="space-y-1">
            {allChapters.map((chapter) => (
              <ChapterRow
                key={chapter.id}
                activeChapterId={activeChapterId}
                chapter={chapter}
                dense
                layoutId="flat-editorial-active-chapter"
                onSelect={onSelectChapter}
                reducedMotion={reducedMotion}
                currentRef={currentRowRef}
              />
            ))}
          </div>
        </div>
      </DeviceFrame>
    </LayoutGroup>
  );
}

function EditorialRendering({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="space-y-5"
    >
      <SectionTitle eyebrow={eyebrow} title={title} description={description} />
      {children}
    </motion.section>
  );
}

export function TocExplorationsRoute() {
  const [activeChapterId, setActiveChapterId] = useState(
    DEFAULT_ACTIVE_CHAPTER_ID,
  );
  const activeChapter = useMemo(
    () =>
      allChapters.find((chapter) => chapter.id === activeChapterId) ??
      allChapters[0],
    [activeChapterId],
  );
  const activePart = activeChapter?.part ?? sampleParts[0];
  const activeChapterIndex = allChapters.findIndex(
    (chapter) => chapter.id === activeChapterId,
  );
  const activeChapterPosition =
    activeChapterIndex === -1 ? 0 : activeChapterIndex + 1;

  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-muted/35 via-background to-background" />

        <div className="relative mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">
          <header className="mb-10 flex flex-col gap-6">
            <Link to="/" className="self-start">
              <Button
                variant="ghost"
                size="lg"
                className="group -ml-1 rounded-xl px-2"
              >
                <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                Back to library
              </Button>
            </Link>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:items-end"
            >
              <div className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  <MetaChip className="bg-card/80">
                    <BookOpen className="mr-2 h-3.5 w-3.5" />
                    Editorial index
                  </MetaChip>
                  <MetaChip className="bg-card/80">2 renderings</MetaChip>
                  <MetaChip className="bg-card/80">Sans UI</MetaChip>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    Ebook reader exploration
                  </p>
                  <h1 className="max-w-4xl text-4xl font-semibold leading-tight text-foreground md:text-5xl">
                    A quieter table of contents for reading.
                  </h1>
                  <p className="max-w-2xl text-base leading-7 text-muted-foreground">
                    Two editorial index treatments using the app’s sans and numeric
                    language: one grouped by table-of-contents sections, one
                    flattened into a single contents list.
                  </p>
                </div>
              </div>

              <div className="rounded-[1.4rem] border border-border/70 bg-card/85 p-5">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  Current location
                </p>
                <div className="mt-4 grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-3">
                  <p className="text-right font-numeric text-3xl font-medium tabular-nums text-foreground">
                    {activeChapter?.number}
                  </p>
                  <div className="min-w-0">
                    <p className="text-lg font-semibold leading-snug text-foreground">
                      {activeChapter?.title}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {activePart.title} / p. {activeChapter?.page}
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/70 pt-4">
                  <div>
                    <p className="font-numeric text-lg font-medium tabular-nums text-foreground">
                      {activeChapterPosition}/{allChapters.length}
                    </p>
                    <p className="text-xs text-muted-foreground">chapter</p>
                  </div>
                  <div>
                    <p className="font-numeric text-lg font-medium tabular-nums text-foreground">
                      {sampleParts.length}
                    </p>
                    <p className="text-xs text-muted-foreground">sections</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </header>

          <div className="grid gap-10 xl:grid-cols-2 xl:items-start">
            <EditorialRendering
              eyebrow="Grouped"
              title="Editorial index with sections"
              description="Keeps the original TOC section hierarchy, but removes the serif voice and turns chapter and page numbers into aligned UI tokens."
            >
              <GroupedEditorialPreview
                activeChapterId={activeChapterId}
                onSelectChapter={setActiveChapterId}
              />
            </EditorialRendering>

            <EditorialRendering
              eyebrow="Flat"
              title="Editorial index without nesting"
              description="Uses the same leader-line rhythm and current-position treatment, but collapses the table of contents into one continuous chapter list."
            >
              <FlatEditorialPreview
                activeChapterId={activeChapterId}
                onSelectChapter={setActiveChapterId}
              />
            </EditorialRendering>
          </div>
        </div>
      </div>
    </div>
  );
}
