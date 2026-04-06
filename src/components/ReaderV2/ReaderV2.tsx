import { HighlightToolbarContainer } from "@/components/Reader/HighlightToolbarContainer";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
    EPUB_HIGHLIGHT_ACTIVE_CLASS,
    EPUB_HIGHLIGHT_CLASS,
    EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
    EPUB_HIGHLIGHT_GROUP_HOVER_CLASS,
} from "@/types/reader.types";
import {
    createHighlightInteractionManager,
    type HighlightInteractionManager,
} from "@zsh-eng/text-highlighter";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PAGE_PADDING_X, PAGE_PADDING_Y } from "./AnimatedSpread";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { SpreadStage } from "./SpreadStage";
import { useReaderV2Core } from "./hooks/use-reader-v2-core";
import { ReaderV2SettingsPopover } from "./shared/ReaderV2SettingsPopover";

const COLUMN_GAP_PX = 20;
const MIN_VIEWPORT_WIDTH_PX = 200;
const MIN_VIEWPORT_HEIGHT_PX = 200;
const MAX_VIEWPORT_WIDTH_PX = 1440;
const MAX_VIEWPORT_HEIGHT_PX = 980;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface ReaderViewport {
  width: number;
  height: number;
}

interface ActiveHighlightState {
  id: string;
  position: { x: number; y: number };
}

function computeViewport(
  stageSlot: HTMLElement,
  spreadColumns: 1 | 2,
): ReaderViewport {
  const availableWidth = Math.max(1, stageSlot.clientWidth);
  const availableHeight = Math.max(1, stageSlot.clientHeight);

  const maxViewportWidthByContainer =
    (availableWidth - PAGE_PADDING_X * 2 - COLUMN_GAP_PX * (spreadColumns - 1)) /
    spreadColumns;
  const maxViewportHeightByContainer = availableHeight - PAGE_PADDING_Y * 2;
  const widthFloor = Math.min(
    MIN_VIEWPORT_WIDTH_PX,
    Math.max(1, maxViewportWidthByContainer),
  );
  const heightFloor = Math.min(
    MIN_VIEWPORT_HEIGHT_PX,
    Math.max(1, maxViewportHeightByContainer),
  );

  const nextWidth = clamp(
    maxViewportWidthByContainer,
    widthFloor,
    MAX_VIEWPORT_WIDTH_PX,
  );
  const nextHeight = clamp(
    maxViewportHeightByContainer,
    heightFloor,
    MAX_VIEWPORT_HEIGHT_PX,
  );

  return { width: nextWidth, height: nextHeight };
}

export function ReaderV2() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [spreadColumns, setSpreadColumns] = useState<1 | 2>(1);
  const stageSlotRef = useRef<HTMLDivElement>(null);
  const stageContentRef = useRef<HTMLDivElement>(null);
  const highlightManagerRef = useRef<HighlightInteractionManager | null>(null);
  const [viewport, setViewport] = useState<ReaderViewport>({
    width: 620,
    height: 860,
  });
  const [activeHighlight, setActiveHighlight] =
    useState<ActiveHighlightState | null>(null);

  const effectiveSpreadColumns: 1 | 2 = isMobile ? 1 : spreadColumns;

  const {
    book,
    isBookLoading,
    settings,
    onUpdateSettings,
    chapterEntries,
    bookHighlights,
    spreadConfig,
    pagination,
    paginationConfig,
    deferredImageCacheRef,
    currentPage,
    totalPages,
  } = useReaderV2Core({
    bookId,
    viewport,
    spreadColumns: effectiveSpreadColumns,
  });

  const visibleSpineItemIds = useMemo(() => {
    if (!pagination.spread) return new Set<string>();

    const ids = new Set<string>();
    const start = pagination.spread.chapterIndexStart;
    const end = pagination.spread.chapterIndexEnd;
    if (start === null || end === null) return ids;

    for (let chapterIndex = start; chapterIndex <= end; chapterIndex++) {
      const chapterEntry = chapterEntries[chapterIndex];
      if (!chapterEntry) continue;
      ids.add(chapterEntry.spineItemId);
    }
    return ids;
  }, [chapterEntries, pagination.spread]);

  const visibleHighlights = useMemo(
    () =>
      bookHighlights.filter((highlight) =>
        visibleSpineItemIds.has(highlight.spineItemId),
      ),
    [bookHighlights, visibleSpineItemIds],
  );

  const activeHighlightData = activeHighlight
    ? bookHighlights.find((highlight) => highlight.id === activeHighlight.id) ?? null
    : null;

  useEffect(() => {
    const container = stageContentRef.current;
    if (!container) return;

    const manager = createHighlightInteractionManager(container, {
      highlightClass: EPUB_HIGHLIGHT_CLASS,
      idAttribute: EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
      hoverClass: EPUB_HIGHLIGHT_GROUP_HOVER_CLASS,
      activeClass: EPUB_HIGHLIGHT_ACTIVE_CLASS,
      onHighlightClick: (id, position) => {
        setActiveHighlight((prev) =>
          prev?.id === id ? null : { id, position },
        );
      },
    });

    highlightManagerRef.current = manager;
    return () => {
      manager.destroy();
      if (highlightManagerRef.current === manager) {
        highlightManagerRef.current = null;
      }
    };
  }, [pagination.spread]);

  useEffect(() => {
    highlightManagerRef.current?.setActiveHighlight(activeHighlight?.id ?? null);
  }, [activeHighlight, pagination.spread]);

  useEffect(() => {
    if (!activeHighlight) return;
    const stillVisible = visibleHighlights.some(
      (highlight) => highlight.id === activeHighlight.id,
    );
    if (!stillVisible) setActiveHighlight(null);
  }, [activeHighlight, visibleHighlights]);

  useLayoutEffect(() => {
    const stageSlot = stageSlotRef.current;
    if (!stageSlot) return;

    const updateViewport = () => {
      setViewport(computeViewport(stageSlot, effectiveSpreadColumns));
    };

    updateViewport();

    const observer = new ResizeObserver(updateViewport);
    observer.observe(stageSlot);

    return () => {
      observer.disconnect();
    };
  }, [effectiveSpreadColumns]);

  useEffect(() => {
    if (isMobile && spreadColumns !== 1) {
      setSpreadColumns(1);
    }
  }, [isMobile, spreadColumns]);

  const currentPageLabel = useMemo(() => {
    if (totalPages <= 0) return "Page - / -";
    return `Page ${currentPage} / ${totalPages}`;
  }, [currentPage, totalPages]);

  if (isBookLoading) {
    return <ReaderStateScreen showSpinner title="Loading book" />;
  }

  if (!bookId || !book) {
    return (
      <ReaderStateScreen
        title="Book not found"
        action={{ label: "Back to Library", onClick: () => navigate("/") }}
      />
    );
  }

  const bottomInsetPadding = "max(env(safe-area-inset-bottom), 0.625rem)";

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <header
        className="z-20 shrink-0 border-b bg-background/95 backdrop-blur-sm"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            aria-label="Back to library"
          >
            <ArrowLeft className="size-4" />
          </Button>

          <div className="min-w-0 flex-1 px-2">
            <p className="truncate text-sm font-medium">{book.title}</p>
            <p className="text-xs text-muted-foreground">{currentPageLabel}</p>
          </div>

          <ReaderV2SettingsPopover
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            showColumnSelector={!isMobile}
            spreadColumns={spreadColumns}
            onSpreadColumnsChange={setSpreadColumns}
          />
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">
        <div
          className="grid h-full grid-rows-[minmax(0,1fr)_auto] px-1 pt-3 sm:px-6 sm:pt-4"
          style={{ paddingBottom: bottomInsetPadding }}
        >
          <div
            ref={stageSlotRef}
            className="min-h-0 flex items-start justify-center overflow-hidden"
          >
            <div
              className={cn(
                "mx-auto overflow-hidden bg-card",
                isMobile
                  ? "rounded-none shadow-none"
                  : "rounded-md border border-border/60 shadow-sm",
              )}
              style={{
                width: `${
                  viewport.width * spreadConfig.columns +
                  COLUMN_GAP_PX * (spreadConfig.columns - 1) +
                  PAGE_PADDING_X * 2
                }px`,
                height: `${viewport.height + PAGE_PADDING_Y * 2}px`,
              }}
            >
              <SpreadStage
                spread={pagination.spread}
                spreadConfig={spreadConfig}
                columnSpacingPx={COLUMN_GAP_PX}
                paginationConfig={paginationConfig}
                bookId={bookId}
                deferredImageCache={deferredImageCacheRef.current}
                stageContentRef={stageContentRef}
              />
            </div>
          </div>

          <div className="flex items-center justify-center pt-2 sm:pt-3">
            <div className="flex items-center gap-2 rounded-full border bg-background/90 p-1.5 shadow backdrop-blur-sm">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous page"
                onClick={pagination.prevSpread}
                disabled={currentPage <= 1}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-24 px-2 text-center text-xs tabular-nums text-muted-foreground">
                {currentPageLabel}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next page"
                onClick={pagination.nextSpread}
                disabled={
                  pagination.status === "ready" &&
                  totalPages > 0 &&
                  currentPage >= totalPages
                }
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </main>

      <HighlightToolbarContainer
        bookId={bookId}
        spineItemId={activeHighlightData?.spineItemId ?? undefined}
        highlights={bookHighlights}
        isCreatingHighlight={false}
        creationPosition={{ x: 0, y: 0 }}
        onCreateColorSelect={(_color) => {
          // ReaderV2 creation flow is handled separately.
        }}
        onCreateClose={() => {}}
        activeHighlight={activeHighlight}
        onEditClose={() => setActiveHighlight(null)}
        isNavVisible={true}
        onCreateNoteSubmit={undefined}
      />
    </div>
  );
}
