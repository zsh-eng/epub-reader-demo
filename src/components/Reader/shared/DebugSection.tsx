import { Button } from "@/components/ui/button";
import type {
  PaginationTracer,
  PaginationTracerSnapshot,
} from "@/lib/pagination-v2";
import { ClipboardCopy, ClipboardPaste, RotateCcw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import {
  parseReaderPageDebugDump,
  type ReaderPageDebugDump,
  type ReaderPageDebugDumpInlineStyleSummary,
  type ReaderPageDebugDumpVisualLineDetail,
  type ReaderPageDebugDumpVisualLineStyleSample,
} from "../debug/page-debug-dump";
import { InspectorSection } from "./InspectorSection";

interface DebugSectionProps {
  tracer: PaginationTracer;
  paginationStatus: string;
  totalPages: number;
  viewport: { width: number; height: number };
  sourceLoadWallClockMs: number | null;
  sourceLoadKind: "cache-hit" | "rebuilt" | null;
  currentDump?: ReaderPageDebugDump | null;
  loadedDump?: ReaderPageDebugDump | null;
  onCopyCurrentDump?: () => void;
  onLoadDump?: (dump: ReaderPageDebugDump) => void;
  onClearLoadedDump?: () => void;
}

function formatMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(1)}ms`;
}

function formatSourceLoad(
  value: number | null | undefined,
  kind: DebugSectionProps["sourceLoadKind"],
): string {
  const kindLabel =
    kind === "cache-hit" ? "cache hit" : kind === "rebuilt" ? "rebuilt" : null;

  if (!kindLabel) return formatMs(value);
  return `${formatMs(value)} (${kindLabel})`;
}

function KVRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

function usePaginationDebugSnapshot(
  tracer: PaginationTracer,
): PaginationTracerSnapshot {
  return useSyncExternalStore(
    tracer.subscribe,
    tracer.getSnapshot,
    tracer.getSnapshot,
  );
}

function DebugDumpSummary({
  dump,
}: {
  dump: ReaderPageDebugDump;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/60 p-2">
      <p className="truncate text-[11px] font-medium text-foreground">
        {dump.book.title}
      </p>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
        Page {dump.page.currentPage} /{" "}
        {Math.round(dump.layout.viewport.width)} x{" "}
        {Math.round(dump.layout.viewport.height)} /{" "}
        {dump.layoutInputs.length} chapter
        {dump.layoutInputs.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function formatPx(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(value % 1 === 0 ? 0 : 2)}px`;
}

function formatOverflow(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  if (value <= 0) return "none";
  return `+${formatPx(value)}`;
}

function formatDelta(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  if (value === 0) return "0px";
  return `${value > 0 ? "+" : ""}${formatPx(value)}`;
}

function formatLineStyle(
  sample: ReaderPageDebugDumpVisualLineStyleSample,
  styleCount: number,
) {
  const stylePrefix = sample.fontStyle === "normal" ? "" : `${sample.fontStyle} `;
  const extraCount = styleCount > 1 ? ` +${styleCount - 1}` : "";

  return `${sample.fontSize} ${stylePrefix}${sample.fontWeight} ${sample.fontFamily}${extraCount}`;
}

function formatInlineLineHeights(
  summaries: ReaderPageDebugDumpInlineStyleSummary[],
) {
  if (summaries.length === 0) return "n/a";

  const lineHeights = new Map<string, number>();
  for (const summary of summaries) {
    lineHeights.set(
      summary.lineHeight,
      (lineHeights.get(summary.lineHeight) ?? 0) + summary.textNodeCount,
    );
  }

  return [...lineHeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([lineHeight, count]) => `${lineHeight} x ${count}`)
    .join(" / ");
}

function formatInlineStyleCount(
  summaries: ReaderPageDebugDumpInlineStyleSummary[],
) {
  if (summaries.length === 0) return "n/a";

  const styleCount = summaries.length;
  const primary = summaries[0];
  if (!primary) return "n/a";

  const extraCount = styleCount > 1 ? ` +${styleCount - 1}` : "";
  return `${primary.fontSize} ${primary.fontWeight} ${primary.fontFamily}${extraCount}`;
}

function formatComputedFont(
  style:
    | {
        fontFamily: string;
        fontSize: string;
        fontWeight: string;
        lineHeight: string;
      }
    | null
    | undefined,
) {
  if (!style) return "n/a";
  return `${style.fontSize} ${style.fontWeight} ${style.fontFamily} / lh ${style.lineHeight}`;
}

function DebugTextSample({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-0.5">
      <span className="text-muted-foreground">{label}</span>
      <p className="break-words rounded-sm bg-muted/50 p-1 text-[10px] leading-snug text-foreground">
        {value}
      </p>
    </div>
  );
}

type DebugDumpPageSlot = NonNullable<
  ReaderPageDebugDump["environment"]
>["pageSlots"][number];

function sumKnownNumbers(values: Array<number | null | undefined>): number {
  return values.reduce<number>(
    (sum, value) =>
      typeof value === "number" && Number.isFinite(value) ? sum + value : sum,
    0,
  );
}

function getPrimaryPageSlot(
  dump: ReaderPageDebugDump,
  pageSlots: DebugDumpPageSlot[],
) {
  return (
    pageSlots.find((pageSlot) => pageSlot.currentPage === dump.page.currentPage) ??
    pageSlots[0]
  );
}

function getPageSliceSummary(pageSlot: DebugDumpPageSlot | undefined) {
  const slices = pageSlot?.slices ?? [];
  const textSlices = slices.filter((slice) => slice.type === "text");
  const expectedSliceHeight = sumKnownNumbers(
    slices.map((slice) => slice.expectedHeight),
  );
  const expectedTextHeight = sumKnownNumbers(
    textSlices.map((slice) => slice.expectedHeight),
  );
  const renderedTextHeight = sumKnownNumbers(
    textSlices.map((slice) => slice.metrics.scrollHeight),
  );
  const expectedTextLines = sumKnownNumbers(
    textSlices.map((slice) => slice.lineCount),
  );
  const visualLineValues = textSlices.map(
    (slice) => slice.visualLines?.lineCount,
  );
  const visualTextLines =
    visualLineValues.some((value) => typeof value === "number")
      ? sumKnownNumbers(visualLineValues)
      : null;
  const overflowingTextSlices = textSlices.filter(
    (slice) => slice.metrics.overflowY > 0,
  );

  return {
    totalSlices: slices.length,
    textSliceCount: textSlices.length,
    expectedSliceHeight,
    expectedTextHeight,
    renderedTextHeight,
    expectedTextLines,
    visualTextLines,
    overflowingTextSliceCount: overflowingTextSlices.length,
    textSliceOverflow: sumKnownNumbers(
      textSlices.map((slice) => Math.max(0, slice.metrics.overflowY)),
    ),
  };
}

function getSliceSuspectScore(
  slice: DebugDumpPageSlot["slices"][number],
  pageContent: DebugDumpPageSlot["contentMetrics"] | undefined,
) {
  const extraDomLines =
    slice.lineCount !== null && slice.visualLines
      ? Math.max(0, slice.visualLines.lineCount - slice.lineCount)
      : 0;
  const overflow = Math.max(0, slice.metrics.overflowY);
  const bottomCrossing = pageContent
    ? Math.max(0, slice.metrics.rect.bottom - pageContent.rect.bottom)
    : 0;

  return extraDomLines * 1_000 + overflow * 10 + bottomCrossing;
}

function getSuspectSlice(
  pageSlot: DebugDumpPageSlot | undefined,
  pageContent: DebugDumpPageSlot["contentMetrics"] | undefined,
) {
  return (pageSlot?.slices ?? [])
    .map((slice) => ({
      slice,
      score: getSliceSuspectScore(slice, pageContent),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)[0]?.slice ?? null;
}

function VisualLineDiagnostic({
  line,
}: {
  line: ReaderPageDebugDumpVisualLineDetail;
}) {
  const primaryStyle = line.styleSamples[0];

  return (
    <>
      <KVRow
        label="Worst Line"
        value={`#${line.index + 1} ${line.issue}`}
      />
      <KVRow
        label="Line Geometry"
        value={`h ${formatPx(line.height)} / stride ${formatPx(
          line.strideToNext,
        )}`}
      />
      <KVRow
        label="Line Delta"
        value={`h ${formatDelta(line.heightDelta)} / stride ${formatDelta(
          line.strideDelta,
        )} / bottom ${formatDelta(line.bottomDelta)}`}
      />
      {primaryStyle ? (
        <KVRow
          label="Line Font"
          value={formatLineStyle(primaryStyle, line.styleSamples.length)}
        />
      ) : null}
      {line.textSample ? (
        <DebugTextSample label="Line Text" value={line.textSample} />
      ) : null}
    </>
  );
}

function DebugDumpEnvironmentSummary({
  dump,
}: {
  dump: ReaderPageDebugDump;
}) {
  const environment = dump.environment;
  if (!environment) return null;

  const primaryPage = getPrimaryPageSlot(dump, environment.pageSlots);
  const pageSliceSummary = getPageSliceSummary(primaryPage);
  const primaryPageContent = primaryPage?.contentMetrics;
  const suspectSlice = getSuspectSlice(primaryPage, primaryPageContent);

  return (
    <div className="space-y-0.5 rounded-md border border-border/60 bg-background/60 p-2">
      <KVRow
        label="Window"
        value={`${environment.window.innerWidth} x ${environment.window.innerHeight}`}
      />
      <KVRow
        label="Visual VP"
        value={
          environment.visualViewport
            ? `${formatPx(environment.visualViewport.width)} x ${formatPx(
                environment.visualViewport.height,
              )}`
            : "n/a"
        }
      />
      <KVRow
        label="Doc Client"
        value={`${environment.documentElement.clientWidth} x ${environment.documentElement.clientHeight}`}
      />
      <KVRow
        label="Safe Area"
        value={`t ${formatPx(environment.safeAreaInsets.top)} / b ${formatPx(
          environment.safeAreaInsets.bottom,
        )}`}
      />
      <div className="my-1 border-t border-border/50" />
      <KVRow
        label="Stage Slot"
        value={
          environment.stageSlot
            ? `${environment.stageSlot.clientWidth} x ${environment.stageSlot.clientHeight}`
            : "n/a"
        }
      />
      <KVRow
        label="Stage Overflow"
        value={formatOverflow(environment.stageSlot?.overflowY)}
      />
      <KVRow
        label="Stage Content"
        value={
          environment.stageContent
            ? `${environment.stageContent.clientWidth} x ${environment.stageContent.clientHeight}`
            : "n/a"
        }
      />
      <KVRow
        label="Content Overflow"
        value={formatOverflow(environment.stageContent?.overflowY)}
      />
      <div className="my-1 border-t border-border/50" />
      <KVRow
        label="Page Slot"
        value={
          primaryPage
            ? `${primaryPage.metrics.clientWidth} x ${primaryPage.metrics.clientHeight}`
            : "n/a"
        }
      />
      <KVRow
        label="Page Overflow"
        value={formatOverflow(primaryPage?.metrics.overflowY)}
      />
      <KVRow
        label="Page Content"
        value={
          primaryPageContent
            ? `${primaryPageContent.clientWidth} x ${primaryPageContent.clientHeight}`
            : "n/a"
        }
      />
      <KVRow
        label="Content Overflow"
        value={formatOverflow(primaryPageContent?.overflowY)}
      />
      <KVRow
        label="Page Slices"
        value={`${pageSliceSummary.totalSlices} (${pageSliceSummary.textSliceCount} text)`}
      />
      <KVRow
        label="Modeled Slices"
        value={`${formatPx(pageSliceSummary.expectedSliceHeight)} / ${formatPx(
          primaryPageContent?.clientHeight,
        )}`}
      />
      <KVRow
        label="Text Lines"
        value={`${pageSliceSummary.expectedTextLines} expected / ${
          pageSliceSummary.visualTextLines ?? "n/a"
        } DOM`}
      />
      <KVRow
        label="Text Height"
        value={`${formatPx(pageSliceSummary.expectedTextHeight)} / ${formatPx(
          pageSliceSummary.renderedTextHeight,
        )}`}
      />
      <KVRow
        label="Text Slice Overflow"
        value={`${formatOverflow(pageSliceSummary.textSliceOverflow)} across ${
          pageSliceSummary.overflowingTextSliceCount
        }`}
      />
      {suspectSlice ? (
        <>
          <div className="my-1 border-t border-border/50" />
          <KVRow
            label="Suspect Slice"
            value={`${suspectSlice.sliceIndex} ${suspectSlice.type}`}
          />
          <KVRow
            label="Slice Lines"
            value={
              suspectSlice.lineCount && suspectSlice.lineHeight
                ? `${suspectSlice.lineCount} x ${formatPx(
                    suspectSlice.lineHeight,
                  )}`
                : "n/a"
            }
          />
          <KVRow
            label="DOM Lines"
            value={
              suspectSlice.visualLines
                ? `${suspectSlice.visualLines.lineCount} lines (${suspectSlice.visualLines.rectCount} rects)`
                : "n/a"
            }
          />
          <KVRow
            label="Slice Height"
            value={`${formatPx(suspectSlice.expectedHeight)} / ${formatPx(
              suspectSlice.metrics.rect.height,
            )}`}
          />
          <KVRow
            label="Slice Overflow"
            value={formatOverflow(suspectSlice.metrics.overflowY)}
          />
          <KVRow
            label="Container Font"
            value={formatComputedFont(suspectSlice.containerStyle)}
          />
          <KVRow
            label="Inline LH"
            value={formatInlineLineHeights(suspectSlice.inlineStyles ?? [])}
          />
          <KVRow
            label="Inline Styles"
            value={formatInlineStyleCount(suspectSlice.inlineStyles ?? [])}
          />
          {suspectSlice.visualLines?.worstLine ? (
            <VisualLineDiagnostic line={suspectSlice.visualLines.worstLine} />
          ) : null}
          {suspectSlice.lineProbe ? (
            <>
              <KVRow
                label="Probe Lines"
                value={`${suspectSlice.lineProbe.sampleLineCount} x ${formatPx(
                  suspectSlice.lineProbe.lineHeightPx,
                )}`}
              />
              <KVRow
                label="Probe Height"
                value={`${formatPx(
                  suspectSlice.lineProbe.expectedHeight,
                )} / ${formatPx(
                  suspectSlice.lineProbe.metrics.scrollHeight,
                )}`}
              />
              <KVRow
                label="Probe Overflow"
                value={`${formatOverflow(
                  suspectSlice.lineProbe.metrics.overflowY,
                )} (${formatPx(suspectSlice.lineProbe.overflowPerLine)}/line)`}
              />
              <KVRow
                label="Probe Font"
                value={`${suspectSlice.lineProbe.fontSize} ${suspectSlice.lineProbe.fontFamily}`}
              />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function DebugDumpControls({
  currentDump,
  loadedDump,
  onCopyCurrentDump,
  onLoadDump,
  onClearLoadedDump,
}: Pick<
  DebugSectionProps,
  | "currentDump"
  | "loadedDump"
  | "onCopyCurrentDump"
  | "onLoadDump"
  | "onClearLoadedDump"
>) {
  const [error, setError] = useState<string | null>(null);
  const [isLoadingClipboard, setIsLoadingClipboard] = useState(false);
  const activeDump = loadedDump ?? currentDump;

  if (
    !currentDump &&
    !loadedDump &&
    !onCopyCurrentDump &&
    !onLoadDump
  ) {
    return null;
  }

  const handleLoadDumpFromClipboard = async () => {
    setIsLoadingClipboard(true);

    try {
      const clipboardText = await navigator.clipboard.readText();
      const dump = parseReaderPageDebugDump(clipboardText);
      onLoadDump?.(dump);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not read a reader debug dump from the clipboard.",
      );
    } finally {
      setIsLoadingClipboard(false);
    }
  };

  return (
    <>
      <div className="my-1.5 border-t border-border/50" />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Page Debug Dump</span>
          {onCopyCurrentDump ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onCopyCurrentDump}
            >
              <ClipboardCopy className="size-3" />
              Copy
            </Button>
          ) : null}
        </div>

        {activeDump ? (
          <div className="space-y-1">
            <span className="text-muted-foreground">
              {loadedDump ? "Loaded Dump" : "Live Dump"}
            </span>
            <DebugDumpSummary dump={activeDump} />
            <DebugDumpEnvironmentSummary dump={activeDump} />
          </div>
        ) : null}

        {onLoadDump ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={isLoadingClipboard}
                onClick={handleLoadDumpFromClipboard}
              >
                <ClipboardPaste className="size-3" />
                {isLoadingClipboard ? "Loading..." : "Paste & Load"}
              </Button>
              {loadedDump && onClearLoadedDump ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={onClearLoadedDump}
                >
                  <RotateCcw className="size-3" />
                  Live
                </Button>
              ) : null}
            </div>
            {error ? (
              <p className="text-[11px] text-destructive">{error}</p>
            ) : null}
          </div>
        ) : null}

      </div>
    </>
  );
}

export function DebugSection({
  tracer,
  paginationStatus,
  totalPages,
  viewport,
  sourceLoadWallClockMs,
  sourceLoadKind,
  currentDump,
  loadedDump,
  onCopyCurrentDump,
  onLoadDump,
  onClearLoadedDump,
}: DebugSectionProps) {
  const snapshot = usePaginationDebugSnapshot(tracer);
  const diagnostics = snapshot.diagnostics;
  const timings = snapshot.timings;

  return (
    <InspectorSection title="Debug & Diagnostics" defaultOpen={true}>
      <div className="space-y-0.5 rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
        <KVRow label="Status" value={paginationStatus} />
        <KVRow
          label="Chapters"
          value={String(diagnostics?.chapterCount ?? "n/a")}
        />
        <KVRow label="Blocks" value={String(diagnostics?.blockCount ?? "n/a")} />
        <KVRow label="Lines" value={String(diagnostics?.lineCount ?? "n/a")} />
        <KVRow label="Pages" value={String(totalPages)} />
        <KVRow
          label="Viewport"
          value={`${Math.round(viewport.width)} x ${Math.round(viewport.height)}`}
        />

        <div className="my-1.5 border-t border-border/50" />

        <KVRow
          label="Source Load"
          value={formatSourceLoad(sourceLoadWallClockMs, sourceLoadKind)}
        />
        <KVRow
          label="First Visible"
          value={formatMs(timings.timeToFirstVisibleMs)}
        />
        <KVRow label="All Ready" value={formatMs(timings.timeToReadyMs)} />

        <div className="my-1.5 border-t border-border/50" />

        <KVRow
          label="Prepare Total"
          value={formatMs(diagnostics?.stage2PrepareMs)}
        />
        <KVRow
          label="Layout Total"
          value={formatMs(diagnostics?.stage3LayoutMs)}
        />
        <KVRow
          label="Pagination Total"
          value={formatMs(diagnostics?.totalMs)}
        />

        <DebugDumpControls
          currentDump={currentDump}
          loadedDump={loadedDump}
          onCopyCurrentDump={onCopyCurrentDump}
          onLoadDump={onLoadDump}
          onClearLoadedDump={onClearLoadedDump}
        />
      </div>
    </InspectorSection>
  );
}
