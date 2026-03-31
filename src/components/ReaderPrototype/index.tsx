import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBookLoader } from "@/hooks/use-book-loader";
import { useEpubProcessor } from "@/hooks/use-epub-processor";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { getBookFile, type Book } from "@/lib/db";
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

interface ChapterEntry {
  index: number;
  href: string;
  title: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(1)}ms`;
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
  bookId: string,
  chapter: ChapterEntry,
): Promise<{ html: string; resourceUrlMap: Map<string, string> }> {
  const chapterFile = await getBookFile(bookId, chapter.href);
  if (!chapterFile) {
    return { html: "", resourceUrlMap: new Map() };
  }

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

  return {
    html: chapterDoc.querySelector("body")?.innerHTML ?? "",
    resourceUrlMap,
  };
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
  const { settings } = useReaderSettings();

  const [jumpInput, setJumpInput] = useState("1");
  const [viewport, setViewport] = useState({ width: 620, height: 860 });
  const resourceMapRef = useRef<Map<number, Map<string, string>>>(new Map());

  const { book, isLoading: isBookLoading } = useBookLoader(bookId);
  const {
    isProcessing: isProcessingEpub,
    isReady: isEpubReady,
    error: epubError,
  } = useEpubProcessor(bookId, book?.fileHash);

  const chapterEntries = useMemo(() => buildChapterEntries(book), [book]);

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

    const cleanupAllResources = () => {
      for (const resourceMap of resourceMapRef.current.values()) {
        cleanupResourceUrls(resourceMap);
      }
      resourceMapRef.current.clear();
    };

    const loadIncrementally = async () => {
      try {
        cleanupAllResources();

        const initialChapter = chapterEntries[0];
        if (!initialChapter) return;

        const initialLoadStartedAt = performance.now();
        const initialLoaded = await loadSingleChapter(bookId, initialChapter);
        const initialSourceLoadMs = performance.now() - initialLoadStartedAt;
        if (cancelled) {
          cleanupResourceUrls(initialLoaded.resourceUrlMap);
          return;
        }
        resourceMapRef.current.set(0, initialLoaded.resourceUrlMap);
        pagination.addChapter(0, initialLoaded.html, {
          sourceLoadMs: initialSourceLoadMs,
        });

        for (let i = 1; i < chapterEntries.length; i++) {
          const chapter = chapterEntries[i];
          if (!chapter) continue;

          const chapterLoadStartedAt = performance.now();
          const loaded = await loadSingleChapter(bookId, chapter);
          const sourceLoadMs = performance.now() - chapterLoadStartedAt;
          if (cancelled) {
            cleanupResourceUrls(loaded.resourceUrlMap);
            return;
          }

          const previousResourceMap = resourceMapRef.current.get(i);
          if (previousResourceMap) {
            cleanupResourceUrls(previousResourceMap);
          }

          resourceMapRef.current.set(i, loaded.resourceUrlMap);
          pagination.addChapter(i, loaded.html, { sourceLoadMs });
        }
      } catch (error) {
        if (!cancelled) {
          console.error(
            "[ReaderPrototype] Failed to stream chapter content",
            error,
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

  useEffect(() => {
    setJumpInput(String(pagination.currentPage));
  }, [pagination.currentPage]);

  const chapterTimingRows = useMemo(() => {
    const chapterTimings = pagination.diagnostics?.chapterTimings ?? [];
    return [...chapterTimings].sort((a, b) => a.chapterIndex - b.chapterIndex);
  }, [pagination.diagnostics?.chapterTimings]);

  const totalSourceLoadMs = useMemo(() => {
    return chapterTimingRows.reduce(
      (sum, chapter) => sum + (chapter.sourceLoadMs ?? 0),
      0,
    );
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

  const handleJumpToPage = useCallback(() => {
    const parsed = Number.parseInt(jumpInput, 10);
    if (!Number.isFinite(parsed)) return;
    const clamped = clamp(parsed, 1, displayTotalPages);
    pagination.goToPage(clamped);
  }, [jumpInput, displayTotalPages, pagination]);

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
              Pretext prototype · Whole book ({chapterEntries.length} chapters)
              {pagination.status === "partial" && " · Preparing..."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={pagination.prevPage}
            disabled={pagination.currentPage <= 1}
          >
            Prev
          </Button>
          <div className="min-w-[132px] text-center text-sm tabular-nums">
            Page {pagination.currentPage} / {displayTotalPages}
            {pagination.status === "partial" && "~"}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={pagination.nextPage}
            disabled={pagination.currentPage >= displayTotalPages}
          >
            Next
          </Button>
          <Input
            type="number"
            min={1}
            max={displayTotalPages}
            value={jumpInput}
            onChange={(event) => setJumpInput(event.target.value)}
            className="h-9 w-24 rounded-md"
          />
          <Button variant="secondary" size="sm" onClick={handleJumpToPage}>
            Jump
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <p className="mb-3 text-xs text-muted-foreground">
          Status: {pagination.status}
          {pagination.diagnostics && (
            <>
              {" "}
              · Blocks: {pagination.diagnostics.blockCount} · Lines:{" "}
              {pagination.diagnostics.lineCount}
              {typeof pagination.diagnostics.stage1ParseMs === "number" && (
                <>
                  {" "}
                  · Stage 1: {formatMs(pagination.diagnostics.stage1ParseMs)} ·
                  Stage 2: {formatMs(pagination.diagnostics.stage2PrepareMs)} ·
                  Stage 3: {formatMs(pagination.diagnostics.stage3LayoutMs)}
                </>
              )}
            </>
          )}{" "}
          · Viewport: {Math.round(viewport.width)}x{Math.round(viewport.height)}{" "}
          · Keyboard: ← / →
        </p>

        {pagination.diagnostics && chapterTimingRows.length > 0 && (
          <section className="mb-4 rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-sm font-medium">Pagination Diagnostics</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Source Load: {formatMs(totalSourceLoadMs)} · Stage 1:{" "}
              {formatMs(pagination.diagnostics.stage1ParseMs)} · Stage 2:{" "}
              {formatMs(pagination.diagnostics.stage2PrepareMs)} · Stage 3:{" "}
              {formatMs(pagination.diagnostics.stage3LayoutMs)} · Total:{" "}
              {formatMs(pagination.diagnostics.totalMs)}
            </p>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[840px] text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">Chapter</th>
                    <th className="py-2 pr-3">Title</th>
                    <th className="py-2 pr-3 tabular-nums">Pages</th>
                    <th className="py-2 pr-3 tabular-nums">Blocks</th>
                    <th className="py-2 pr-3 tabular-nums">Lines</th>
                    <th className="py-2 pr-3 tabular-nums">Source Load</th>
                    <th className="py-2 pr-3 tabular-nums">Stage 1</th>
                    <th className="py-2 pr-3 tabular-nums">Stage 2</th>
                    <th className="py-2 pr-3 tabular-nums">Stage 3</th>
                    <th className="py-2 pr-3 tabular-nums">Chapter Load</th>
                    <th className="py-2 pr-0 tabular-nums">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {chapterTimingRows.map((chapter) => (
                    <tr key={chapter.chapterIndex} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 tabular-nums">
                        {chapter.chapterIndex + 1}
                      </td>
                      <td className="py-2 pr-3">
                        {chapterEntries[chapter.chapterIndex]?.title ??
                          `Chapter ${chapter.chapterIndex + 1}`}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{chapter.pageCount}</td>
                      <td className="py-2 pr-3 tabular-nums">{chapter.blockCount}</td>
                      <td className="py-2 pr-3 tabular-nums">{chapter.lineCount}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatMs(chapter.sourceLoadMs)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatMs(chapter.stage1ParseMs)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatMs(chapter.stage2PrepareMs)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatMs(chapter.stage3LayoutMs)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatMs(chapter.chapterLoadMs)}
                      </td>
                      <td className="py-2 pr-0 tabular-nums">
                        {formatMs(chapter.totalMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="rounded-xl border bg-card p-4 shadow-sm md:p-6">
          <div
            className="mx-auto overflow-hidden rounded-lg bg-background"
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
                pagination.slices.map((slice, i) => renderPageSlice(slice, i))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
