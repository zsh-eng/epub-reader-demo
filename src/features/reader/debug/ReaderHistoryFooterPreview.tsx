import { useState } from "react";
import type { DeviceType } from "@/types/session";
import { Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReaderFooter } from "../footer/ReaderFooter";
import type { ChapterEntry } from "../types";
import type {
  PlaygroundAction,
  PlaygroundSession,
} from "./jump-history-playground";
import { ReaderHistoryStrip } from "./ReaderHistoryStrip";

const TOTAL = 1200;
const STARTS = [1, 75, 125, 200, 350, 600, 900];
const CHAPTERS: ChapterEntry[] = STARTS.map((_, index) => ({
  index,
  spineItemId: `sample-${index}`,
  href: `sample-${index}`,
  title: `Chapter ${["I", "II", "III", "IV", "V", "VI", "VII"][index]}`,
}));
const SAMPLE_PAGES: Record<string, number> = {
  A: 81,
  B: 140,
  C: 25,
  D: 210,
  H1: 140,
  H2: 142,
  H3: 145,
  H4: 270,
  R1: 146,
  R2: 147,
  B1: 230,
  B2: 240,
  B3: 250,
};

// Explicit sample device metadata. Real history does not retain the source device yet.
const SAMPLE_HANDOFF_DEVICES: Partial<Record<string, DeviceType>> = {
  Phone140: "mobile",
  Desktop25: "desktop",
  Tablet210: "tablet",
};

/** Presentation-only sample pages. The real Reader will resolve stored anchors
 * against its current pagination; these labels never change the saved history. */
export function samplePage(destination: string): number {
  if (SAMPLE_PAGES[destination]) return SAMPLE_PAGES[destination];
  const numeric = Number(destination.match(/\d+$/)?.[0]);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(TOTAL, numeric)) : 81;
}

interface ReaderHistoryFooterPreviewProps {
  session: PlaygroundSession;
  nextActionLabel: string;
  canStep: boolean;
  onStep: () => void;
  animate: boolean;
  onAction: (action: PlaygroundAction, animate?: boolean) => void;
}

export function ReaderHistoryFooterPreview({
  session,
  animate,
  onAction,
  nextActionLabel,
  canStep,
  onStep,
}: ReaderHistoryFooterPreviewProps) {
  const [mobile, setMobile] = useState(true);
  const [contentsOpen, setContentsOpen] = useState(false);
  const { snapshot, preview, historyVisible, firstSlot } = session;
  const entries = snapshot.entries.map((entry, index) => ({
    slot: firstSlot + index,
    page: samplePage(entry.anchor.blockId),
    kind: entry.kind,
    deviceType: SAMPLE_HANDOFF_DEVICES[entry.anchor.blockId],
  }));
  const page = preview ? samplePage(preview) : entries[snapshot.cursor].page;
  const chapter = STARTS.filter((start) => start <= page).length - 1;
  const expanded = historyVisible && preview === null;
  const visit = (
    kind: "normal" | "scrubber" | "preview" | "chapter" | "toc",
    destination: number,
  ) => {
    onAction({ type: "visit", kind, destination: String(destination) });
  };
  return (
    <section
      className="-mx-4 rounded-2xl border border-border bg-background p-0 sm:mx-0 sm:p-4"
      aria-labelledby="footer-preview-heading"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-0 sm:pt-0">
        <h2 id="footer-preview-heading" className="text-sm font-semibold">
          Footer preview
        </h2>
        <div className="flex gap-1" aria-label="Preview width">
          <Button
            size="sm"
            variant={mobile ? "secondary" : "ghost"}
            aria-pressed={mobile}
            onClick={() => setMobile(true)}
          >
            <Smartphone /> Mobile
          </Button>
          <Button
            size="sm"
            variant={!mobile ? "secondary" : "ghost"}
            aria-pressed={!mobile}
            onClick={() => setMobile(false)}
          >
            <Monitor /> Desktop
          </Button>
        </div>
      </div>
      <div
        data-testid="history-footer-preview"
        data-width={mobile ? "mobile" : "desktop"}
        className="relative mx-auto h-[360px] max-w-full overflow-hidden rounded-xl border border-border bg-background"
        style={{ width: mobile ? 390 : "100%" }}
      >
        <div className="px-6 pt-6">
          <p className="text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            A reading detour
          </p>
          <p className="mt-4 font-serif text-lg leading-relaxed text-foreground">
            A passage sends you elsewhere in the book. Your earlier place stays
            in the trail, ready for you to return.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => visit("normal", page - 1)}
            >
              Read previous page
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= TOTAL}
              onClick={() => visit("normal", page + 1)}
            >
              Read next page
            </Button>
          </div>
        </div>
        {contentsOpen && (
          <div
            className="absolute inset-x-4 top-4 z-30 rounded-xl border border-border bg-background p-3 shadow-lg"
            role="group"
            aria-label="Sample chapters"
          >
            {CHAPTERS.map((item, index) => (
              <Button
                key={item.index}
                size="sm"
                variant="ghost"
                onClick={() => {
                  visit("toc", STARTS[index]);
                  setContentsOpen(false);
                }}
              >
                {item.title}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setContentsOpen(false)}
            >
              Close contents
            </Button>
          </div>
        )}
        <ReaderFooter
          key={mobile ? "mobile" : "desktop"}
          chromeVisible
          isMobile={mobile}
          currentPage={page}
          totalPages={TOTAL}
          currentChapterIndex={chapter}
          currentChapterEndIndex={chapter}
          displayChapterIndex={chapter}
          isContentsOpen={contentsOpen}
          chapterEntries={CHAPTERS}
          chapterStartPages={STARTS}
          onScrubPreview={(target) => visit("preview", target)}
          onScrubCommit={(target) => visit("scrubber", target)}
          onGoToChapter={(target) => visit("chapter", STARTS[target])}
          onPrevChapter={() =>
            visit("chapter", STARTS[Math.max(0, chapter - 1)])
          }
          onOpenContents={() => setContentsOpen((open) => !open)}
          pageIndicator={
            <ReaderHistoryStrip
              entries={entries}
              cursor={snapshot.cursor}
              page={page}
              total={TOTAL}
              expanded={expanded}
              animate={animate}
              onSelect={(targetIndex, motion) =>
                onAction({ type: "history", targetIndex }, motion)
              }
              onExpandedChange={(show, motion) =>
                onAction(
                  { type: show ? "show-history" : "hide-history" },
                  motion,
                )
              }
            />
          }
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 px-4 sm:px-0">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {preview
            ? "Scrub preview · history unchanged"
            : expanded
              ? "Tap a neighbouring page to return. Left and right follow the trail."
              : "Quiet mode · tap the page count to reveal history."}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onAction({ type: expanded ? "hide-history" : "show-history" })
          }
        >
          {expanded ? "Quiet mode" : "Show history"}
        </Button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border px-4 pt-3 sm:px-0">
        <span className="text-xs text-muted-foreground">{nextActionLabel}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!canStep}
          onClick={onStep}
        >
          Next example step
        </Button>
      </div>
      <p className="mt-2 px-4 pb-4 text-[11px] text-muted-foreground sm:px-0 sm:pb-0">
        Real footer · sample pages 1–1200 · sample yellow highlights and devices
      </p>
    </section>
  );
}
