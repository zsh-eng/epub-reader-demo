import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PAGE_PADDING_X, PAGE_PADDING_Y } from "./AnimatedSpread";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { SpreadStage } from "./SpreadStage";
import { useReaderViewport } from "./hooks/use-reader-viewport";
import { useReaderV2Core } from "./hooks/use-reader-v2-core";
import { DebugSection } from "./shared/DebugSection";
import { InspectorDrawer } from "./shared/InspectorDrawer";
import { InspectorPanel } from "./shared/InspectorPanel";

export function ReaderV2Debug() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [paragraphSpacingFactor, setParagraphSpacingFactor] = useState(1.2);
  const [spreadColumns, setSpreadColumns] = useState<1 | 2 | 3>(1);
  const [columnSpacingPx, setColumnSpacingPx] = useState(16);

  const { viewport, setViewport, viewportAutoMode, setViewportAutoMode } =
    useReaderViewport({ isMobile, isPanelOpen });

  const {
    book,
    isBookLoading,
    settings,
    onUpdateSettings,
    chapterEntries,
    spreadConfig,
    paginationConfig,
    pagination,
    deferredImageCacheRef,
    sourceLoadWallClockMs,
    currentPage,
    totalPages,
    currentChapterIndex,
  } = useReaderV2Core({
    bookId,
    viewport,
    spreadColumns,
    paragraphSpacingFactor,
  });

  if (isBookLoading) {
    return <ReaderStateScreen showSpinner />;
  }

  if (!bookId || !book) {
    return (
      <ReaderStateScreen
        title="Book not found"
        action={{ label: "Back to Library", onClick: () => navigate("/") }}
      />
    );
  }

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
    onUpdateSettings,
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
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <p className="flex-1 truncate text-center text-sm font-medium italic">
            {book.title}
          </p>
          <button
            onClick={() => setIsPanelOpen((open) => !open)}
            className={cn(
              "rounded-lg p-2 text-muted-foreground transition-all duration-500 hover:bg-muted hover:text-foreground",
              isPanelOpen && "bg-muted text-foreground",
            )}
          >
            <SlidersHorizontal className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {!isMobile && isPanelOpen && (
          <aside className="w-[320px] shrink-0 overflow-y-auto border-r px-3">
            <div className="space-y-1 py-2">
              <DebugSection {...debugSectionProps} />
            </div>
          </aside>
        )}

        <main className="flex-1 overflow-auto">
          <div className="w-full overflow-x-auto px-4 pb-6 pt-6">
            <div
              key={`${viewport.width}-${viewport.height}-${spreadConfig.columns}-${columnSpacingPx}`}
              className="reader-container-outline mx-auto overflow-hidden"
              style={{
                width: `${
                  viewport.width * spreadConfig.columns +
                  columnSpacingPx * (spreadConfig.columns - 1) +
                  PAGE_PADDING_X * 2
                }px`,
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
                showDebugOutlines
              />
            </div>
          </div>
        </main>

        {!isMobile && isPanelOpen && (
          <aside className="w-[320px] shrink-0 overflow-y-auto border-l px-3">
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
