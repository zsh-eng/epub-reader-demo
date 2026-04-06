import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ArrowLeft, ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PAGE_PADDING_X, PAGE_PADDING_Y } from "./AnimatedSpread";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { SpreadStage } from "./SpreadStage";
import { useReaderV2Core } from "./hooks/use-reader-v2-core";
import { ReaderSettingsPanel } from "./shared/ReaderSettingsPanel";

const COLUMN_GAP_PX = 20;
const VIEWPORT_HORIZONTAL_PADDING_PX = 48;
const VIEWPORT_VERTICAL_PADDING_PX = 140;
const MIN_VIEWPORT_WIDTH_PX = 240;
const MAX_VIEWPORT_WIDTH_PX = 1440;
const MIN_VIEWPORT_HEIGHT_PX = 300;
const MAX_VIEWPORT_HEIGHT_PX = 980;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface ReaderViewport {
  width: number;
  height: number;
}

function computeViewport(container: HTMLElement): ReaderViewport {
  const nextWidth = clamp(
    container.clientWidth - VIEWPORT_HORIZONTAL_PADDING_PX,
    MIN_VIEWPORT_WIDTH_PX,
    MAX_VIEWPORT_WIDTH_PX,
  );
  const nextHeight = clamp(
    container.clientHeight - VIEWPORT_VERTICAL_PADDING_PX,
    MIN_VIEWPORT_HEIGHT_PX,
    MAX_VIEWPORT_HEIGHT_PX,
  );

  return { width: nextWidth, height: nextHeight };
}

export function ReaderV2() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [spreadColumns, setSpreadColumns] = useState<1 | 2>(1);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ReaderViewport>({
    width: 620,
    height: 860,
  });

  const effectiveSpreadColumns: 1 | 2 = isMobile ? 1 : spreadColumns;

  const {
    book,
    isBookLoading,
    settings,
    onUpdateSettings,
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

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateViewport = () => {
      setViewport(computeViewport(container));
    };

    updateViewport();

    const observer = new ResizeObserver(updateViewport);
    observer.observe(container);
    window.addEventListener("resize", updateViewport);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

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

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur-sm">
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

          <Sheet open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Reader settings"
              >
                <Settings className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Reader Settings</SheetTitle>
                <SheetDescription>
                  Adjust typography, theme, and layout.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6">
                <ReaderSettingsPanel
                  settings={settings}
                  onUpdateSettings={onUpdateSettings}
                  showColumnSelector={!isMobile}
                  spreadColumns={spreadColumns}
                  onSpreadColumnsChange={setSpreadColumns}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main ref={containerRef} className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 overflow-auto px-4 py-6 sm:px-6">
          <div
            className="mx-auto overflow-hidden rounded-md bg-card shadow-sm"
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
            />
          </div>
        </div>

        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-4 z-10 px-4 sm:px-6",
            "flex items-center justify-center",
          )}
        >
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/90 p-1.5 shadow backdrop-blur-sm">
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
      </main>
    </div>
  );
}
