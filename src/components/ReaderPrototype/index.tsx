import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBookLoader } from "@/hooks/use-book-loader";
import { useEpubProcessor } from "@/hooks/use-epub-processor";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { getBookFile, type Book } from "@/lib/db";
import { cleanupResourceUrls, processEmbeddedResources } from "@/lib/epub-resource-utils";
import {
    layoutPages,
    parseChapterHtml,
    prepareBlocks,
    type Block,
    type FontConfig,
    type LayoutTheme,
    type PageSlice,
} from "@/lib/pagination";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import { cn } from "@/lib/utils";
import type { FontFamily, ReaderSettings } from "@/types/reader.types";
import { useQuery } from "@tanstack/react-query";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactElement,
} from "react";
import { useNavigate, useParams } from "react-router-dom";

interface ChapterEntry {
  index: number;
  href: string;
  title: string;
}

interface LoadedChapter extends ChapterEntry {
  html: string;
  resourceUrlMap: Map<string, string>;
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

function buildLayoutTheme(settings: ReaderSettings): LayoutTheme {
  return {
    baseFontSizePx: 16 * (settings.fontSize / 100),
    lineHeightFactor: settings.lineHeight,
    paragraphSpacingFactor: 1.2,
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
      const manifestItem = book.manifest.find((item) => item.id === spineItem.idref);
      if (!manifestItem?.href) return null;

      return {
        index,
        href: manifestItem.href,
        title: getChapterTitleFromSpine(book, index) || `Chapter ${index + 1}`,
      };
    })
    .filter((chapter): chapter is ChapterEntry => Boolean(chapter));
}

async function loadAllChapterContents(
  bookId: string,
  chapters: ChapterEntry[],
): Promise<LoadedChapter[]> {
  const loaded: LoadedChapter[] = [];

  for (const chapter of chapters) {
    const chapterFile = await getBookFile(bookId, chapter.href);
    if (!chapterFile) continue;

    const text = await chapterFile.content.text();
    const resourceUrlMap = new Map<string, string>();

    const { document: chapterDoc } = await processEmbeddedResources({
      content: text,
      mediaType: chapterFile.mediaType,
      basePath: chapter.href,
      loadResource: async (path: string) => {
        const resourceFile = await getBookFile(bookId, path);
        return resourceFile?.content || null;
      },
      resourceUrlMap,
    });

    loaded.push({
      ...chapter,
      html: chapterDoc.querySelector("body")?.innerHTML ?? "",
      resourceUrlMap,
    });
  }

  return loaded;
}

function cleanupChapterResources(chapters: LoadedChapter[] | null): void {
  if (!chapters) return;
  for (const chapter of chapters) {
    cleanupResourceUrls(chapter.resourceUrlMap);
  }
}

function renderPageSlice(slice: PageSlice, sliceIndex: number): ReactElement {
  const key = `${slice.blockId}-${sliceIndex}`;

  if (slice.type === "spacer") {
    return <div key={key} style={{ height: `${slice.height}px` }} />;
  }

  if (slice.type === "image") {
    return (
      <div key={key} className="flex justify-center">
        <img
          src={slice.src}
          alt={slice.alt || "Chapter image"}
          style={{
            width: `${slice.width}px`,
            height: `${slice.height}px`,
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
                  fragment.leadingGap > 0 ? `${fragment.leadingGap}px` : undefined,
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function ReaderPrototype() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { settings } = useReaderSettings();

  const [currentPage, setCurrentPage] = useState(1);
  const [jumpInput, setJumpInput] = useState("1");
  const [manualRecomputeVersion, setManualRecomputeVersion] = useState(0);
  const [viewport, setViewport] = useState({ width: 620, height: 860 });

  const previousChaptersRef = useRef<LoadedChapter[] | null>(null);

  const { book, isLoading: isBookLoading } = useBookLoader(bookId);
  const {
    isProcessing: isProcessingEpub,
    isReady: isEpubReady,
    error: epubError,
  } = useEpubProcessor(bookId, book?.fileHash);

  const chapterEntries = useMemo(() => buildChapterEntries(book), [book]);
  const chapterKey = useMemo(
    () => chapterEntries.map((chapter) => chapter.href).join("|"),
    [chapterEntries],
  );

  const allChaptersQuery = useQuery({
    queryKey: ["reader-prototype-book-chapters", bookId ?? "", chapterKey],
    queryFn: () => loadAllChapterContents(bookId!, chapterEntries),
    enabled: !!bookId && !!book && isEpubReady && chapterEntries.length > 0,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });

  useEffect(() => {
    const previousChapters = previousChaptersRef.current;
    if (previousChapters && previousChapters !== allChaptersQuery.data) {
      cleanupChapterResources(previousChapters);
    }
    previousChaptersRef.current = allChaptersQuery.data ?? null;
  }, [allChaptersQuery.data]);

  useEffect(() => {
    return () => {
      cleanupChapterResources(previousChaptersRef.current);
      previousChaptersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      const horizontalPadding = isMobile ? 32 : 120;
      const verticalPadding = isMobile ? 270 : 300;
      setViewport({
        width: clamp(window.innerWidth - horizontalPadding, 240, 760),
        height: clamp(window.innerHeight - verticalPadding, 300, 980),
      });
    };

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isMobile]);

  const fontConfig = useMemo(() => buildFontConfig(settings), [settings]);
  const layoutTheme = useMemo(() => buildLayoutTheme(settings), [settings]);

  // Stage 1: parse HTML into blocks (only re-runs when chapters change)
  const blocks = useMemo(() => {
    const loadedChapters = allChaptersQuery.data;
    if (!loadedChapters || loadedChapters.length === 0) return [] as Block[];

    const result: Block[] = [];
    loadedChapters.forEach((chapter, index) => {
      result.push(...parseChapterHtml(chapter.html));
      if (index < loadedChapters.length - 1) {
        result.push({ type: "page-break", id: `page-break-${chapter.index + 1}` });
      }
    });
    return result;
  }, [allChaptersQuery.data]);

  // Stage 2: prepare blocks with font measurement (re-runs on font change)
  const prepared = useMemo(() => {
    if (blocks.length === 0) return [];
    return prepareBlocks(blocks, fontConfig);
  }, [blocks, fontConfig]);

  // Stage 3: layout pages (re-runs on resize, cheap)
  const paginationResult = useMemo(() => {
    return layoutPages(prepared, viewport.width, viewport.height, layoutTheme);
  }, [prepared, viewport.width, viewport.height, layoutTheme, manualRecomputeVersion]);

  const totalPages = paginationResult.pages.length;

  useEffect(() => {
    setCurrentPage((prev) =>
      clamp(prev, 1, Math.max(1, totalPages)),
    );
  }, [totalPages]);

  useEffect(() => {
    setJumpInput(String(currentPage));
  }, [currentPage]);

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
        setCurrentPage((pageNumber) => Math.max(1, pageNumber - 1));
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setCurrentPage((pageNumber) =>
          Math.min(totalPages, pageNumber + 1),
        );
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [totalPages]);

  const page =
    paginationResult.pages[
      clamp(currentPage - 1, 0, paginationResult.pages.length - 1)
    ];

  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  const handleJumpToPage = () => {
    const parsed = Number.parseInt(jumpInput, 10);
    if (!Number.isFinite(parsed)) return;
    const clamped = clamp(parsed, 1, totalPages);
    setCurrentPage(clamped);
  };

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

  if (
    isProcessingEpub ||
    !isEpubReady ||
    allChaptersQuery.isLoading ||
    allChaptersQuery.isFetching
  ) {
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

  if (
    epubError ||
    allChaptersQuery.error ||
    chapterEntries.length === 0 ||
    !allChaptersQuery.data ||
    allChaptersQuery.data.length === 0
  ) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="space-y-3 text-center max-w-md px-4">
          <p className="font-medium text-destructive">
            Failed to build prototype pagination
          </p>
          <p className="text-sm text-muted-foreground">
            {epubError
              ? epubError.message
              : allChaptersQuery.error
                ? getErrorMessage(allChaptersQuery.error)
                : "No readable chapters were found."}
          </p>
          <Button variant="outline" onClick={() => navigate("/")}>
            Back to Library
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <Button variant="outline" onClick={() => navigate("/")}>
            Back
          </Button>
          <div className="mr-auto min-w-[180px]">
            <p className="truncate text-sm font-medium">{book.title}</p>
            <p className="text-xs text-muted-foreground">
              Pretext prototype · Whole book ({allChaptersQuery.data.length} chapters)
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((pageNumber) => pageNumber - 1)}
            disabled={!canGoPrevious}
          >
            Prev
          </Button>
          <div className="min-w-[132px] text-center text-sm tabular-nums">
            Page {currentPage} / {totalPages}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((pageNumber) => pageNumber + 1)}
            disabled={!canGoNext}
          >
            Next
          </Button>
          <Input
            type="number"
            min={1}
            max={totalPages}
            value={jumpInput}
            onChange={(event) => setJumpInput(event.target.value)}
            className="h-9 w-24 rounded-md"
          />
          <Button variant="secondary" size="sm" onClick={handleJumpToPage}>
            Jump
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setManualRecomputeVersion((value) => value + 1)}
          >
            Recompute
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <p className="mb-3 text-xs text-muted-foreground">
          Blocks: {paginationResult.diagnostics.blockCount} · Lines:{" "}
          {paginationResult.diagnostics.lineCount} · Recompute:{" "}
          {paginationResult.diagnostics.computeMs.toFixed(1)}ms · Viewport:{" "}
          {Math.round(viewport.width)}×{Math.round(viewport.height)} ·
          Keyboard: ← / →
        </p>

        <div className="rounded-xl border bg-card p-4 shadow-sm md:p-6">
          <div
            className="mx-auto overflow-hidden rounded-lg bg-background"
            style={{
              width: `${viewport.width}px`,
              height: `${viewport.height}px`,
            }}
          >
            <div className="h-full w-full overflow-hidden">
              {page?.slices.map((slice, i) => renderPageSlice(slice, i))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
