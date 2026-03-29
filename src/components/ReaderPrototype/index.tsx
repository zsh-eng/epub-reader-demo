import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBookLoader } from "@/hooks/use-book-loader";
import {
    getManifestItemHref,
    useChapterContent,
} from "@/hooks/use-chapter-content";
import { useEpubProcessor } from "@/hooks/use-epub-processor";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import {
    extractPaginationBlocksFromHtml,
    paginateBlocksWithPretext,
    type ChapterTypography,
    type PageSlice,
} from "@/lib/pagination/pretext-pagination";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import { cn } from "@/lib/utils";
import type { ReaderSettings } from "@/types/reader.types";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type ReactElement,
} from "react";
import { useNavigate, useParams } from "react-router-dom";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getNamedBodyFont(fontFamily: string): string {
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

function buildChapterTypography(
  settings: ReaderSettings,
): ChapterTypography {
  const baseFontSizePx = 16 * (settings.fontSize / 100);
  return {
    baseFontSizePx,
    baseLineHeight: baseFontSizePx * settings.lineHeight,
    textAlign: settings.textAlign,
    bodyFontFamily: getNamedBodyFont(settings.fontFamily),
    headingFontFamily: `"EB Garamond", Georgia, serif`,
    codeFontFamily: `"Courier New", Menlo, Monaco, monospace`,
  };
}

function renderPageSlice(slice: PageSlice): ReactElement {
  if (slice.type === "spacer") {
    return <div key={slice.id} style={{ height: `${slice.height}px` }} />;
  }

  if (slice.type === "image") {
    return (
      <div key={slice.id} className="flex justify-center">
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
    <div key={slice.id}>
      {slice.lines.map((line, lineIndex) => (
        <div
          key={`${slice.id}-line-${lineIndex}`}
          className="overflow-hidden whitespace-nowrap"
          style={{
            height: `${slice.lineHeight}px`,
            lineHeight: `${slice.lineHeight}px`,
            textAlign: slice.textAlign,
          }}
        >
          {line.fragments.map((fragment, fragmentIndex) => (
            <span
              key={`${slice.id}-line-${lineIndex}-fragment-${fragmentIndex}`}
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

export function ReaderPrototype() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { settings } = useReaderSettings();

  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpInput, setJumpInput] = useState("1");
  const [manualRecomputeVersion, setManualRecomputeVersion] = useState(0);
  const [viewport, setViewport] = useState({ width: 620, height: 860 });
  const initializedBookIdRef = useRef<string | null>(null);

  const { book, isLoading: isBookLoading } = useBookLoader(bookId);
  const {
    isProcessing: isProcessingEpub,
    isReady: isEpubReady,
    error: epubError,
  } = useEpubProcessor(bookId, book?.fileHash);

  useEffect(() => {
    if (!book) return;
    if (initializedBookIdRef.current === book.id) return;
    initializedBookIdRef.current = book.id;

    const preferredIndex = book.spine.length > 1 ? 1 : 0;
    const preferredHref = getManifestItemHref(book, preferredIndex);
    if (preferredHref) {
      setCurrentChapterIndex(preferredIndex);
      return;
    }

    const firstAvailableIndex = book.spine.findIndex((_, index) =>
      Boolean(getManifestItemHref(book, index)),
    );
    setCurrentChapterIndex(firstAvailableIndex >= 0 ? firstAvailableIndex : 0);
  }, [book]);

  const chapterHref = getManifestItemHref(book, currentChapterIndex);
  const {
    chapterContent,
    isLoading: isChapterLoading,
    error: chapterError,
  } = useChapterContent(bookId, chapterHref);

  const chapterOptions = useMemo(() => {
    if (!book) return [];

    return book.spine
      .map((_, index) => {
        const href = getManifestItemHref(book, index);
        if (!href) return null;

        const title = getChapterTitleFromSpine(book, index) || `Chapter ${index + 1}`;
        return {
          index,
          href,
          title,
        };
      })
      .filter((option): option is { index: number; href: string; title: string } =>
        Boolean(option),
      );
  }, [book]);

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

  const typography = useMemo(() => buildChapterTypography(settings), [settings]);

  const blocks = useMemo(() => {
    if (!chapterContent) return [];
    return extractPaginationBlocksFromHtml(chapterContent, typography, viewport.width);
  }, [chapterContent, typography, viewport.width]);

  const paginationResult = useMemo(() => {
    return paginateBlocksWithPretext({
      blocks,
      pageWidth: viewport.width,
      pageHeight: viewport.height,
    });
  }, [blocks, viewport.height, viewport.width, manualRecomputeVersion]);

  useEffect(() => {
    setCurrentPage(1);
    setJumpInput("1");
  }, [currentChapterIndex]);

  useEffect(() => {
    setCurrentPage((prev) =>
      clamp(prev, 1, Math.max(1, paginationResult.totalPages)),
    );
  }, [paginationResult.totalPages]);

  useEffect(() => {
    setJumpInput(String(currentPage));
  }, [currentPage]);

  const page =
    paginationResult.pages[clamp(currentPage - 1, 0, paginationResult.pages.length - 1)];

  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < paginationResult.totalPages;

  const handleJumpToPage = () => {
    const parsed = Number.parseInt(jumpInput, 10);
    if (!Number.isFinite(parsed)) return;
    const clamped = clamp(parsed, 1, paginationResult.totalPages);
    setCurrentPage(clamped);
  };

  const handleChapterSelect = (event: ChangeEvent<HTMLSelectElement>) => {
    const parsedIndex = Number.parseInt(event.target.value, 10);
    if (!Number.isFinite(parsedIndex)) return;
    setCurrentChapterIndex(parsedIndex);
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

  if (isProcessingEpub || !isEpubReady || isChapterLoading) {
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

  if (epubError || chapterError || !chapterHref) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="space-y-3 text-center max-w-md px-4">
          <p className="font-medium text-destructive">
            Failed to build prototype pagination
          </p>
          <p className="text-sm text-muted-foreground">
            {epubError?.message || chapterError?.message || "Chapter data is missing."}
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
              Pretext prototype · Chapter {currentChapterIndex + 1} ({chapterHref})
            </p>
          </div>
          <select
            value={currentChapterIndex}
            onChange={handleChapterSelect}
            className="h-9 max-w-[240px] rounded-md border border-input bg-background px-2 text-sm"
          >
            {chapterOptions.map((option) => (
              <option key={option.href} value={option.index}>
                {option.index + 1}. {option.title}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((pageNum) => pageNum - 1)}
            disabled={!canGoPrevious}
          >
            Prev
          </Button>
          <div className="min-w-[112px] text-center text-sm tabular-nums">
            Page {currentPage} / {paginationResult.totalPages}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((pageNum) => pageNum + 1)}
            disabled={!canGoNext}
          >
            Next
          </Button>
          <Input
            type="number"
            min={1}
            max={paginationResult.totalPages}
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
          {paginationResult.diagnostics.recomputeMs.toFixed(1)}ms · Viewport:{" "}
          {Math.round(viewport.width)}×{Math.round(viewport.height)}
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
              {page?.slices.map((slice) => renderPageSlice(slice))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
