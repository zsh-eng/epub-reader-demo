import { useBookLoader } from "@/hooks/use-book-loader";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import {
    getBookFile,
    getBookFilesByPaths,
    getBookImageDimensionsMap,
    type Book,
    type BookFile,
} from "@/lib/db";
import {
    cleanupResourceUrls,
    processEmbeddedResources,
} from "@/lib/epub-resource-utils";
import {
    parseChapterHtml,
    usePagination,
    type PaginationConfig,
    type SpreadConfig,
} from "@/lib/pagination-v2";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import { cn } from "@/lib/utils";
import type { FontFamily, ReaderSettings } from "@/types/reader.types";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DebugSection } from "./shared/DebugSection";
import { InspectorDrawer } from "./shared/InspectorDrawer";
import { InspectorPanel } from "./shared/InspectorPanel";
import { PAGE_PADDING_X, PAGE_PADDING_Y } from "./AnimatedSpread";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { SpreadStage } from "./SpreadStage";
import { usePaginationKeyboardNav } from "./hooks/use-pagination-keyboard-nav";
import { useReaderViewport } from "./hooks/use-reader-viewport";

interface ChapterEntry {
  index: number;
  href: string;
  title: string;
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

function buildPaginationConfig(
  settings: ReaderSettings,
  paragraphSpacingFactor: number,
  viewport: { width: number; height: number },
): PaginationConfig {
  return {
    fontConfig: {
      bodyFamily: getNamedBodyFont(settings.fontFamily),
      headingFamily: getNamedBodyFont(settings.fontFamily),
      codeFamily: `"Courier New", Menlo, Monaco, monospace`,
      baseSizePx: 16 * (settings.fontSize / 100),
    },
    layoutTheme: {
      baseFontSizePx: 16 * (settings.fontSize / 100),
      lineHeightFactor: settings.lineHeight,
      paragraphSpacingFactor,
      headingSpaceAbove: 1.5,
      headingSpaceBelow: 0.7,
      textAlign: settings.textAlign,
    },
    viewport,
  };
}

function buildSpreadConfig(): SpreadConfig {
  return {
    columns: 1,
    chapterFlow: "continuous",
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
    .filter((ch): ch is ChapterEntry => Boolean(ch));
}

async function processChapterHtml(
  chapterFile: BookFile | undefined,
  chapter: ChapterEntry,
  imageDimensionsByPath: Map<string, { width: number; height: number }>,
): Promise<string> {
  if (!chapterFile) return "";
  const text = await chapterFile.content.text();
  const { document: chapterDoc } = await processEmbeddedResources({
    content: text,
    mediaType: chapterFile.mediaType,
    basePath: chapter.href,
    loadResource: async () => null,
    skipImages: true,
    loadLinkedResources: false,
    imageDimensionsByPath,
  });
  return chapterDoc.querySelector("body")?.innerHTML ?? "";
}

export function ReaderV2() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { settings, updateSettings } = useReaderSettings();

  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [paragraphSpacingFactor, setParagraphSpacingFactor] = useState(1.2);
  const [spreadColumns, setSpreadColumns] = useState<1 | 2 | 3>(1);
  const [columnSpacingPx, setColumnSpacingPx] = useState(16);
  const deferredImageCacheRef = useRef<Map<string, string>>(new Map());
  const [sourceLoadWallClockMs, setSourceLoadWallClockMs] = useState<
    number | null
  >(null);

  const { book, isLoading: isBookLoading } = useBookLoader(bookId);

  const chapterEntries = useMemo(() => buildChapterEntries(book), [book]);

  const { viewport, setViewport, viewportAutoMode, setViewportAutoMode } =
    useReaderViewport({ isMobile, isPanelOpen });

  const paginationConfig = useMemo(
    () => buildPaginationConfig(settings, paragraphSpacingFactor, viewport),
    [settings, paragraphSpacingFactor, viewport],
  );

  const spreadConfig = useMemo<SpreadConfig>(
    () => ({
      ...buildSpreadConfig(),
      columns: spreadColumns,
    }),
    [spreadColumns],
  );

  const pagination = usePagination({
    paginationConfig,
    spreadConfig,
  });

  usePaginationKeyboardNav({
    onPrevSpread: pagination.prevSpread,
    onNextSpread: pagination.nextSpread,
  });

  // Load all chapters at once, then init + addChapter
  useEffect(() => {
    if (!bookId || chapterEntries.length === 0) return;

    let cancelled = false;
    setSourceLoadWallClockMs(null);

    const cleanupAllResources = () => {
      cleanupResourceUrls(deferredImageCacheRef.current);
    };

    const loadAll = async () => {
      const startedAt = performance.now();

      try {
        cleanupAllResources();
        const imageDimensionsByPath = await getBookImageDimensionsMap(bookId);

        // Load and parse ALL chapters in one shot.
        const allPaths = chapterEntries.map((ch) => ch.href);
        const [firstFile, restFiles] = await Promise.all([
          getBookFile(bookId, chapterEntries[0]!.href),
          getBookFilesByPaths(bookId, allPaths.slice(1)),
        ]);

        if (cancelled) return;

        // Process and parse all chapters on the main thread (DOM required).
        const firstHtml = await processChapterHtml(
          firstFile,
          chapterEntries[0]!,
          imageDimensionsByPath,
        );
        if (cancelled) return;

        const firstBlocks = parseChapterHtml(firstHtml);

        pagination.init({
          totalChapters: chapterEntries.length,
          initialChapterIndex: 0,
          firstChapterBlocks: firstBlocks,
        });

        for (let i = 1; i < chapterEntries.length; i++) {
          const chapter = chapterEntries[i]!;
          const file = restFiles.get(chapter.href);
          const html = await processChapterHtml(
            file,
            chapter,
            imageDimensionsByPath,
          );
          if (cancelled) return;

          const blocks = parseChapterHtml(html);
          pagination.addChapter(i, blocks);
        }

        if (!cancelled) {
          setSourceLoadWallClockMs(performance.now() - startedAt);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[ReaderV2] Failed to load chapters", error);
        }
      }
    };

    void loadAll();

    return () => {
      cancelled = true;
      cleanupAllResources();
    };
  }, [bookId, chapterEntries, pagination.init, pagination.addChapter]);

  if (isBookLoading) {
    return <ReaderStateScreen />;
  }

  if (!bookId || !book) {
    return (
      <ReaderStateScreen
        title="Book not found"
        action={{ label: "Back to Library", onClick: () => navigate("/") }}
      />
    );
  }

  const currentPage = pagination.spread?.currentPage ?? 1;
  const totalPages = pagination.spread?.totalPages ?? 0;
  const currentChapterIndex = pagination.spread?.chapterIndexStart ?? 0;

  const panelProps = {
    currentPage,
    totalPages,
    paginationStatus: pagination.status,
    onGoToPage: pagination.goToPage,
    onGoToChapterIndex: pagination.goToChapter,
    onNextSpread: pagination.nextSpread,
    onPrevSpread: pagination.prevSpread,
    chapterEntries,
    currentChapterIndex,
    settings,
    onUpdateSettings: (patch: Partial<ReaderSettings>) => {
      if (patch.fontFamily && patch.fontFamily !== settings.fontFamily) {
        pagination.markFontSwitchIntent(settings.fontFamily, patch.fontFamily);
      }
      updateSettings(patch);
    },
    viewport,
    onViewportChange: setViewport,
    viewportAutoMode,
    onViewportAutoModeChange: setViewportAutoMode,
    paragraphSpacingFactor,
    onParagraphSpacingFactorChange: setParagraphSpacingFactor,
    spreadColumns,
    onSpreadColumnsChange: setSpreadColumns,
    columnSpacingPx,
    onColumnSpacingPxChange: setColumnSpacingPx,
  };

  const debugSectionProps = {
    tracer: pagination.tracer,
    paginationStatus: pagination.status,
    totalPages,
    viewport,
    sourceLoadWallClockMs,
    addChapterSendWallClockMs: null,
    chapterTitles: (index: number) =>
      chapterEntries[index]?.title ?? `Chapter ${index + 1}`,
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button
            onClick={() => navigate("/")}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
          <p className="flex-1 truncate text-center text-sm italic font-medium">
            {book.title}
          </p>
          <button
            onClick={() => setIsPanelOpen((o) => !o)}
            className={cn(
              "rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-500",

              isPanelOpen && "bg-muted text-foreground",
            )}
          >
            <SlidersHorizontal className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {!isMobile && isPanelOpen && (
          <aside className="w-[320px] shrink-0 border-r overflow-y-auto px-3">
            <div className="space-y-1 py-2">
              <DebugSection {...debugSectionProps} />
            </div>
          </aside>
        )}

        <main className="flex-1 overflow-auto">
          <div className="w-full overflow-x-auto pt-6 pb-6 px-4">
            <div
              key={`${viewport.width}-${viewport.height}-${spreadConfig.columns}-${columnSpacingPx}`}
              className="reader-container-outline mx-auto overflow-hidden"
              style={{
                width: `${viewport.width * spreadConfig.columns + columnSpacingPx * (spreadConfig.columns - 1) + PAGE_PADDING_X * 2}px`,
                height: `${viewport.height + PAGE_PADDING_Y * 2}px`,
              }}
            >
              <SpreadStage
                spread={pagination.spread}
                spreadConfig={spreadConfig}
                columnSpacingPx={columnSpacingPx}
                paginationConfig={paginationConfig}
                bookId={bookId}
                deferredImageCache={deferredImageCacheRef.current}
              />
            </div>
          </div>
        </main>

        {!isMobile && isPanelOpen && (
          <aside className="w-[320px] shrink-0 border-l overflow-y-auto px-3">
            <InspectorPanel {...panelProps} />
          </aside>
        )}
      </div>

      {isMobile && (
        <InspectorDrawer open={isPanelOpen} onOpenChange={setIsPanelOpen}>
          <InspectorPanel {...panelProps} />
          <div className="space-y-1 py-2">
            <DebugSection {...debugSectionProps} />
          </div>
        </InspectorDrawer>
      )}
    </div>
  );
}
