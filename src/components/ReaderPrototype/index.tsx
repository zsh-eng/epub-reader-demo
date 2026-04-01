import { Button } from "@/components/ui/button";
import { LazyImage } from "@/components/ReaderPrototype/LazyImage";
import { useBookLoader } from "@/hooks/use-book-loader";
import { useEpubProcessor } from "@/hooks/use-epub-processor";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { getBookFile, getBookFilesByPaths, type Book, type BookFile } from "@/lib/db";
import {
  cleanupResourceUrls,
  processEmbeddedResources,
} from "@/lib/epub-resource-utils";
import {
  usePagination,
  type FontConfig,
  type LayoutTheme,
  type PageSlice,
} from "@/lib/pagination";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import { cn } from "@/lib/utils";
import type { FontFamily, ReaderSettings } from "@/types/reader.types";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import { InspectorPanel } from "./InspectorPanel";
import { InspectorDrawer } from "./InspectorDrawer";

interface ChapterEntry {
  index: number;
  href: string;
  title: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getNamedBodyFont(fontFamily: FontFamily): string {
  switch (fontFamily) {
    case "sans-serif":
    case "inter":
      return `"Inter", "Helvetica Neue", Arial, sans-serif`;
    case "monospace":
      return `"Courier New", Menlo, Monaco, monospace`;
    case "lora":
      return `"Lora", Georgia, serif`;
    case "iowan":
      return `"Iowan Old Style", "Palatino Linotype", serif`;
    case "garamond":
      return `"EB Garamond", Garamond, serif`;
    case "serif":
    default:
      return `"EB Garamond", Georgia, serif`;
  }
}

function buildFontConfig(settings: ReaderSettings): FontConfig {
  return {
    bodyFamily: getNamedBodyFont(settings.fontFamily),
    headingFamily: `"EB Garamond", Georgia, serif`,
    codeFamily: `"Courier New", Menlo, Monaco, monospace`,
    baseSizePx: 16 * (settings.fontSize / 100),
  };
}

function buildLayoutTheme(
  settings: ReaderSettings,
  paragraphSpacingFactor: number,
): LayoutTheme {
  return {
    baseFontSizePx: 16 * (settings.fontSize / 100),
    lineHeightFactor: settings.lineHeight,
    paragraphSpacingFactor,
    headingSpaceAbove: 1.5,
    headingSpaceBelow: 0.7,
    textAlign: settings.textAlign,
  };
}

function buildChapterEntries(book: Book | null): ChapterEntry[] {
  if (!book) return [];

  return book.spine
    .map((_, index) => {
      const spineItem = book.spine[index];
      if (!spineItem) return null;
      const manifestItem = book.manifest.find(
        (item) => item.id === spineItem.idref,
      );
      if (!manifestItem?.href) return null;

      return {
        index,
        href: manifestItem.href,
        title: getChapterTitleFromSpine(book, index) || `Chapter ${index + 1}`,
      };
    })
    .filter((chapter): chapter is ChapterEntry => Boolean(chapter));
}

async function loadSingleChapter(
  chapterFile: BookFile | undefined,
  chapter: ChapterEntry,
): Promise<string> {
  if (!chapterFile) {
    return "";
  }

  const text = await chapterFile.content.text();

  const { document: chapterDoc } = await processEmbeddedResources({
    content: text,
    mediaType: chapterFile.mediaType,
    basePath: chapter.href,
    loadResource: async () => null,
    skipImages: true,
    loadLinkedResources: false,
  });

  return chapterDoc.querySelector("body")?.innerHTML ?? "";
}

function renderPageSlice(
  slice: PageSlice,
  sliceIndex: number,
  bookId: string,
  deferredImageCache: Map<string, string>,
): ReactElement {
  const key = `${slice.blockId}-${sliceIndex}`;

  if (slice.type === "spacer") {
    return <div key={key} style={{ height: `${slice.height}px` }} />;
  }

  if (slice.type === "image") {
    return (
      <div key={key} className="flex justify-center">
        <LazyImage
          bookId={bookId}
          src={slice.src}
          alt={slice.alt || "Chapter image"}
          cache={deferredImageCache}
          width={slice.width}
          height={slice.height}
          style={{
            objectFit: "contain",
          }}
        />
      </div>
    );
  }

  return (
    <div key={key}>
      {slice.lines.map((line, lineIndex) => (
        <div
          key={`${key}-line-${lineIndex}`}
          className="overflow-hidden whitespace-nowrap"
          style={{
            height: `${slice.lineHeight}px`,
            lineHeight: `${slice.lineHeight}px`,
            textAlign: slice.textAlign,
          }}
        >
          {line.fragments.map((fragment, fragmentIndex) => (
            <span
              key={`${key}-line-${lineIndex}-frag-${fragmentIndex}`}
              style={{
                marginLeft:
                  fragment.leadingGap > 0
                    ? `${fragment.leadingGap}px`
                    : undefined,
                font: fragment.font,
              }}
              className={cn({
                underline: fragment.isLink,
                "font-medium": fragment.isCode,
              })}
            >
              {fragment.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ReaderPrototype() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { settings, updateSettings } = useReaderSettings();

  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [viewportAutoMode, setViewportAutoMode] = useState(true);
  const [paragraphSpacingFactor, setParagraphSpacingFactor] = useState(1.2);
  const [viewport, setViewport] = useState({ width: 620, height: 860 });
  const deferredImageCacheRef = useRef<Map<string, string>>(new Map());
  const [sourceLoadWallClockMs, setSourceLoadWallClockMs] = useState<
    number | null
  >(null);
  const [addChapterSendWallClockMs, setAddChapterSendWallClockMs] = useState<
    number | null
  >(null);

  // Toggle button inactivity fade
  const [headerActive, setHeaderActive] = useState(true);
  const inactivityTimerRef = useRef<number>(undefined);
  const resetInactivityTimer = useCallback(() => {
    setHeaderActive(true);
    clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = window.setTimeout(
      () => setHeaderActive(false),
      3000,
    );
  }, []);

  useEffect(() => {
    resetInactivityTimer();
    return () => clearTimeout(inactivityTimerRef.current);
  }, [resetInactivityTimer]);

  const { book, isLoading: isBookLoading } = useBookLoader(bookId);
  const {
    isProcessing: isProcessingEpub,
    isReady: isEpubReady,
    error: epubError,
  } = useEpubProcessor(bookId, book?.fileHash);

  const chapterEntries = useMemo(() => buildChapterEntries(book), [book]);

  // Viewport auto-resize
  useEffect(() => {
    if (!viewportAutoMode) return;

    const onResize = () => {
      const panelWidth = !isMobile && isPanelOpen ? 320 : 0;
      const horizontalPadding = (isMobile ? 32 : 120) + panelWidth;
      const verticalPadding = isMobile ? 270 : 300;
      setViewport({
        width: clamp(window.innerWidth - horizontalPadding, 240, 760),
        height: clamp(window.innerHeight - verticalPadding, 300, 980),
      });
    };

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isMobile, viewportAutoMode, isPanelOpen]);

  const fontConfig = useMemo(() => buildFontConfig(settings), [settings]);
  const layoutTheme = useMemo(
    () => buildLayoutTheme(settings, paragraphSpacingFactor),
    [settings, paragraphSpacingFactor],
  );

  const pagination = usePagination({
    totalChapters: chapterEntries.length,
    fontConfig,
    layoutTheme,
    viewport,
    initialChapterIndex: 0,
  });

  useEffect(() => {
    if (!bookId || !isEpubReady || chapterEntries.length === 0) {
      return;
    }

    let cancelled = false;
    setSourceLoadWallClockMs(null);
    setAddChapterSendWallClockMs(null);

    const cleanupAllResources = () => {
      cleanupResourceUrls(deferredImageCacheRef.current);
    };

    const loadIncrementally = async () => {
      const sourceLoadStartedAt = performance.now();
      let lastAddChapterSentAt: number | null = null;

      try {
        cleanupAllResources();

        const initialChapter = chapterEntries[0];
        if (!initialChapter) return;

        const initialChapterFile = await getBookFile(
          bookId,
          initialChapter.href,
        );
        const initialHtml = await loadSingleChapter(
          initialChapterFile,
          initialChapter,
        );
        if (cancelled) return;
        pagination.addChapter(0, initialHtml);
        lastAddChapterSentAt = performance.now();

        const remainingChapters = chapterEntries.slice(1);
        if (remainingChapters.length > 0) {
          const remainingChapterPaths = remainingChapters.map(
            (chapter) => chapter.href,
          );
          const chaptersByPath = await getBookFilesByPaths(
            bookId,
            remainingChapterPaths,
          );
          if (cancelled) return;

          for (let i = 1; i < chapterEntries.length; i++) {
            const chapter = chapterEntries[i];
            if (!chapter) continue;

            const chapterFile = chaptersByPath.get(chapter.href);
            const chapterHtml = await loadSingleChapter(chapterFile, chapter);
            if (cancelled) return;

            pagination.addChapter(i, chapterHtml);
            lastAddChapterSentAt = performance.now();
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error(
            "[ReaderPrototype] Failed to stream chapter content",
            error,
          );
        }
      } finally {
        if (!cancelled) {
          const loadFinishedAt = performance.now();
          setSourceLoadWallClockMs(loadFinishedAt - sourceLoadStartedAt);
          setAddChapterSendWallClockMs(
            lastAddChapterSentAt === null
              ? null
              : lastAddChapterSentAt - sourceLoadStartedAt,
          );
        }
      }
    };

    void loadIncrementally();

    return () => {
      cancelled = true;
      cleanupAllResources();
    };
  }, [bookId, isEpubReady, chapterEntries, pagination.addChapter]);

  const displayTotalPages =
    pagination.totalPages ?? pagination.estimatedTotalPages ?? 0;

  const chapterTimingRows = useMemo(() => {
    const chapterTimings = pagination.diagnostics?.chapterTimings ?? [];
    return [...chapterTimings].sort((a, b) => a.chapterIndex - b.chapterIndex);
  }, [pagination.diagnostics?.chapterTimings]);

  // Derive current chapter index from page position
  const currentChapterIndex = useMemo(() => {
    if (chapterTimingRows.length === 0) return 0;
    let acc = 0;
    for (const ch of chapterTimingRows) {
      acc += ch.pageCount;
      if (pagination.currentPage <= acc) return ch.chapterIndex;
    }
    return chapterTimingRows.at(-1)?.chapterIndex ?? 0;
  }, [pagination.currentPage, chapterTimingRows]);

  // Compute first page for each chapter
  const chapterFirstPages = useMemo(() => {
    const map = new Map<number, number>();
    let acc = 1;
    for (const ch of chapterTimingRows) {
      map.set(ch.chapterIndex, acc);
      acc += ch.pageCount;
    }
    return map;
  }, [chapterTimingRows]);

  // Keyboard navigation
  const paginationRef = useRef(pagination);
  paginationRef.current = pagination;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName.toLowerCase();
        if (
          tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        paginationRef.current.prevPage();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        paginationRef.current.nextPage();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (isBookLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <p className="text-sm text-muted-foreground">
            Preparing Pretext pagination prototype...
          </p>
        </div>
      </div>
    );
  }

  if (!bookId || !book) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="space-y-3 text-center">
          <p className="font-medium">Book not found</p>
          <Button variant="outline" onClick={() => navigate("/")}>
            Back to Library
          </Button>
        </div>
      </div>
    );
  }

  if (isProcessingEpub || !isEpubReady) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <p className="text-sm text-muted-foreground">
            Preparing Pretext pagination prototype...
          </p>
        </div>
      </div>
    );
  }

  if (epubError || chapterEntries.length === 0) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="space-y-3 text-center max-w-md px-4">
          <p className="font-medium text-destructive">
            Failed to build prototype pagination
          </p>
          <p className="text-sm text-muted-foreground">
            {epubError ? epubError.message : "No readable chapters were found."}
          </p>
          <Button variant="outline" onClick={() => navigate("/")}>
            Back to Library
          </Button>
        </div>
      </div>
    );
  }

  const panelProps = {
    currentPage: pagination.currentPage,
    totalPages: displayTotalPages,
    paginationStatus: pagination.status,
    onGoToPage: pagination.goToPage,
    onNextPage: pagination.nextPage,
    onPrevPage: pagination.prevPage,
    chapterEntries,
    currentChapterIndex,
    chapterFirstPages,
    settings,
    onUpdateSettings: updateSettings,
    viewport,
    onViewportChange: setViewport,
    viewportAutoMode,
    onViewportAutoModeChange: setViewportAutoMode,
    paragraphSpacingFactor,
    onParagraphSpacingFactorChange: setParagraphSpacingFactor,
    diagnostics: pagination.diagnostics,
    sourceLoadWallClockMs,
    addChapterSendWallClockMs,
    chapterTimingRows,
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Minimal header */}
      <header
        className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm"
        onMouseMove={resetInactivityTimer}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/")}>
            Back
          </Button>
          <div className="mr-auto min-w-0">
            <p className="truncate text-sm font-medium">{book.title}</p>
            <p className="text-xs text-muted-foreground">
              Pretext prototype · {chapterEntries.length} chapters
              {pagination.status === "partial" && " · Preparing..."}
            </p>
          </div>
          <button
            onClick={() => setIsPanelOpen((o) => !o)}
            className={cn(
              "rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-500",
              headerActive || isPanelOpen ? "opacity-100" : "opacity-30",
              isPanelOpen && "bg-muted text-foreground",
            )}
          >
            <SlidersHorizontal className="size-4" />
          </button>
        </div>
      </header>

      {/* Content + Panel */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto">
            <div
              className="mx-auto overflow-hidden rounded-lg border bg-background"
              style={{
                width: `${viewport.width}px`,
                height: `${viewport.height}px`,
              }}
            >
              <div className="h-full w-full overflow-hidden">
                {pagination.status === "loading" &&
                pagination.slices.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
                  </div>
                ) : (
                  pagination.slices.map((slice, i) =>
                    renderPageSlice(
                      slice,
                      i,
                      bookId,
                      deferredImageCacheRef.current,
                    ),
                  )
                )}
              </div>
            </div>
          </div>
        </main>

        {/* Desktop panel */}
        {!isMobile && isPanelOpen && (
          <aside className="w-[320px] shrink-0 border-l overflow-y-auto px-3">
            <InspectorPanel {...panelProps} />
          </aside>
        )}
      </div>

      {/* Mobile drawer */}
      {isMobile && (
        <InspectorDrawer open={isPanelOpen} onOpenChange={setIsPanelOpen}>
          <InspectorPanel {...panelProps} />
        </InspectorDrawer>
      )}
    </div>
  );
}
