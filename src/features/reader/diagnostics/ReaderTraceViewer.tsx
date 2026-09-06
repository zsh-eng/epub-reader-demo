import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  clearReaderTraces,
  READER_TRACE_LANES,
  setReaderTraceRecordingEnabled,
  type ReaderPerformanceTrace,
  type ReaderTraceLane,
  type ReaderTraceSpan,
  useReaderTraceSnapshot,
} from "@/lib/reader-performance-trace";
import { cn } from "@/lib/utils";
import { Activity, Check, ClipboardCopy, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const LANE_LABELS: Record<ReaderTraceLane, string> = {
  navigation: "Navigation",
  storage: "Storage",
  processing: "Main thread",
  pagination: "Worker round trip",
  assets: "Assets",
  reveal: "Reveal",
};

const LANE_COLOR_VALUES: Record<ReaderTraceLane, string> = {
  navigation: "var(--yellow-primary, var(--yellow-secondary))",
  storage: "var(--blue-primary, var(--blue-secondary))",
  processing: "var(--magenta-primary, var(--magenta-secondary))",
  pagination: "var(--green-primary, var(--green-secondary))",
  assets: "var(--purple-primary, var(--blue-secondary))",
  reveal: "var(--cyan-primary, var(--green-secondary))",
};

interface PositionedSpan {
  span: ReaderTraceSpan;
  track: number;
}

interface HoveredSpan {
  span: ReaderTraceSpan;
  clientX: number;
  clientY: number;
}

interface TimelineGuide {
  atMs: number;
  color: string;
  label: string;
  span: ReaderTraceSpan;
}

const TIMELINE_GUIDE_DEFINITIONS: Array<{
  color: string;
  edge: "start" | "end";
  label: string;
  spanName: string;
}> = [
  {
    spanName: "reader-route-dom-committed",
    label: "Route DOM committed",
    edge: "start",
    color: LANE_COLOR_VALUES.navigation,
  },
  {
    spanName: "reader-route-mounted",
    label: "Route passive effect",
    edge: "start",
    color: LANE_COLOR_VALUES.navigation,
  },
  {
    spanName: "pagination-first-spread",
    label: "First spread returned",
    edge: "end",
    color: LANE_COLOR_VALUES.pagination,
  },
  {
    spanName: "first-spread-frame-painted",
    label: "First spread frame",
    edge: "start",
    color: LANE_COLOR_VALUES.reveal,
  },
  {
    spanName: "display-assets-settle",
    label: "Visible assets settled",
    edge: "end",
    color: LANE_COLOR_VALUES.assets,
  },
  {
    spanName: "reader-settled-frame-painted",
    label: "Reader settled",
    edge: "start",
    color: LANE_COLOR_VALUES.reveal,
  },
  {
    spanName: "all-chapters-paginated",
    label: "Full pagination",
    edge: "start",
    color: LANE_COLOR_VALUES.pagination,
  },
];

function formatMilliseconds(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

function formatTraceDetail(
  key: string,
  value: string | number | boolean | null,
): string {
  if (typeof value === "number" && key.endsWith("Ms")) {
    return formatMilliseconds(value);
  }
  return String(value);
}

function getTraceDuration(trace: ReaderPerformanceTrace): number {
  if (trace.durationMs !== null) return trace.durationMs;
  return Math.max(
    1,
    Date.now() - trace.startedAt,
    ...trace.spans.map((span) => span.endMs ?? span.startMs),
  );
}

function getFirstSpreadFrameMs(trace: ReaderPerformanceTrace): number | null {
  return (
    trace.spans.find((span) => span.name === "first-spread-frame-painted")
      ?.startMs ??
    trace.spans.find((span) => span.name === "first-reader-frame-painted")
      ?.startMs ??
    null
  );
}

function getSettledContentPaintMs(
  trace: ReaderPerformanceTrace,
): number | null {
  return (
    trace.spans.find((span) => span.name === "reader-settled-frame-painted")
      ?.startMs ??
    trace.spans.find((span) => span.name === "first-reader-frame-painted")
      ?.startMs ??
    null
  );
}

function getSpanTime(
  trace: ReaderPerformanceTrace,
  spanName: string,
  edge: "start" | "end" = "start",
): number | null {
  const span = trace.spans.find((candidate) => candidate.name === spanName);
  if (!span) return null;
  return edge === "end" ? (span.endMs ?? span.startMs) : span.startMs;
}

function getChapterSource(trace: ReaderPerformanceTrace): string {
  const bodyCacheLoadKind = trace.spans.find(
    (span) => span.name === "reader-body-cache-load",
  )?.details.loadKind;

  if (bodyCacheLoadKind === "cache-hit") return "Cache hit";
  if (bodyCacheLoadKind === "rebuilt") return "Rebuilt";
  return trace.status === "recording" ? "Pending" : "Outside trace";
}

function formatTraceDetailsForClipboard(trace: ReaderPerformanceTrace): string {
  const firstSpreadFrameMs = getFirstSpreadFrameMs(trace);
  const assetsSettledMs = getSpanTime(trace, "display-assets-settle", "end");
  const displayReadyMs = getSpanTime(trace, "reader-display-ready");
  const settledContentPaintMs = getSettledContentPaintMs(trace);
  const durationMs = getTraceDuration(trace);
  const formatOptionalTime = (value: number | null) =>
    value === null ? "not recorded" : formatMilliseconds(value);
  const formatInterval = (start: number | null, end: number | null) =>
    start === null || end === null
      ? "not recorded"
      : formatMilliseconds(Math.max(0, end - start));
  const metadata = Object.entries(trace.metadata)
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join("\n");
  const events = [...trace.spans]
    .sort((left, right) => left.startMs - right.startMs)
    .map((span) => {
      const endMs = span.endMs ?? span.startMs;
      const details = Object.entries(span.details)
        .map(([key, value]) => `${key}=${formatTraceDetail(key, value)}`)
        .join(", ");
      return [
        `- ${formatMilliseconds(span.startMs)} → ${formatMilliseconds(endMs)}`,
        `[${span.lane}]`,
        span.name,
        `(${formatMilliseconds(Math.max(0, endMs - span.startMs))}, ${span.status})`,
        details ? `{ ${details} }` : "",
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join("\n");

  return [
    "Reader performance trace",
    `Book: ${trace.bookTitle ?? trace.bookId}`,
    `Trace ID: ${trace.id}`,
    `Started: ${new Date(trace.startedAt).toISOString()}`,
    `Source: ${trace.source}`,
    `Status: ${trace.status}`,
    `CPU throttle: ${formatCpuThrottle(trace)}`,
    `Publisher styles: ${trace.metadata.publisherBookStylingEnabled === true ? "On" : "Off"}`,
    `Chapter source: ${getChapterSource(trace)}`,
    "",
    "Milestones",
    `- First spread frame: ${formatOptionalTime(firstSpreadFrameMs)}`,
    `- Visible assets settled: ${formatOptionalTime(assetsSettledMs)}`,
    `- Reader display-ready commit: ${formatOptionalTime(displayReadyMs)}`,
    `- Visible content settled: ${formatOptionalTime(settledContentPaintMs)}`,
    `- Full pagination trace: ${formatMilliseconds(durationMs)}`,
    "",
    "First spread to settled breakdown",
    `- Visible image and document-font wait: ${formatInterval(firstSpreadFrameMs, assetsSettledMs)}`,
    `- Ready-state React commit: ${formatInterval(assetsSettledMs, displayReadyMs)}`,
    `- Painted-frame confirmation: ${formatInterval(displayReadyMs, settledContentPaintMs)}`,
    "",
    "Run metadata",
    metadata || "- none",
    "",
    "Events",
    events || "- none",
  ].join("\n");
}

function formatTraceTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function formatCpuThrottle(trace: ReaderPerformanceTrace): string {
  const mainThreadRate = trace.metadata.mainThreadCpuThrottleRate;
  if (typeof mainThreadRate !== "number") return "Not recorded";

  const workerRate = trace.metadata.workerCpuThrottleRate;
  if (typeof workerRate !== "number") return `${mainThreadRate}× main`;
  return `${mainThreadRate}× main · ${workerRate}× worker`;
}

function getTimelineGuides(trace: ReaderPerformanceTrace): TimelineGuide[] {
  return TIMELINE_GUIDE_DEFINITIONS.flatMap((definition) => {
    const span = trace.spans.find(
      (candidate) => candidate.name === definition.spanName,
    );
    if (!span) return [];

    return [
      {
        atMs:
          definition.edge === "end"
            ? (span.endMs ?? span.startMs)
            : span.startMs,
        color: definition.color,
        label: definition.label,
        span,
      },
    ];
  });
}

function packSpans(spans: ReaderTraceSpan[]): PositionedSpan[] {
  const trackEnds: number[] = [];
  return [...spans]
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "span" ? -1 : 1;
      return left.startMs - right.startMs;
    })
    .map((span) => {
      if (span.kind === "mark") return { span, track: 0 };

      const endMs = span.endMs ?? span.startMs;
      let track = trackEnds.findIndex((trackEnd) => span.startMs >= trackEnd);
      if (track === -1) track = trackEnds.length;
      trackEnds[track] = endMs + 1;
      return { span, track };
    });
}

function SpanTooltip({ hovered }: { hovered: HoveredSpan }): React.ReactNode {
  const { span } = hovered;
  const durationMs = Math.max(0, (span.endMs ?? span.startMs) - span.startMs);
  const left = Math.min(hovered.clientX + 12, window.innerWidth - 324);
  const top = Math.min(hovered.clientY + 12, window.innerHeight - 180);

  return (
    <div
      className="pointer-events-none fixed z-50 w-max max-w-80 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
    >
      <p className="text-xs font-semibold">{span.name}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {formatMilliseconds(span.startMs)} →{" "}
        {formatMilliseconds(span.endMs ?? span.startMs)} ·{" "}
        {formatMilliseconds(durationMs)}
      </p>
      {Object.keys(span.details).length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          {Object.entries(span.details).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="truncate text-right">
                {formatTraceDetail(key, value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function TimelineLane({
  lane,
  spans,
  durationMs,
  searchTerm,
  onHover,
}: {
  lane: ReaderTraceLane;
  spans: ReaderTraceSpan[];
  durationMs: number;
  searchTerm: string;
  onHover: (hovered: HoveredSpan | null) => void;
}): React.ReactNode {
  const positionedSpans = packSpans(spans);
  const trackCount = Math.max(
    1,
    ...positionedSpans
      .filter(({ span }) => span.kind === "span")
      .map(({ track }) => track + 1),
  );
  const laneHeight = Math.max(32, trackCount * 22 + 8);

  return (
    <div className="grid grid-cols-[8.5rem_minmax(48rem,1fr)] border-t border-border/60">
      <div className="flex items-center border-r border-border/60 px-3 text-xs font-medium text-muted-foreground">
        {LANE_LABELS[lane]}
      </div>
      <div
        className="relative bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)] bg-[size:25%_100%]"
        style={{ height: laneHeight }}
      >
        {positionedSpans.map(({ span, track }) => {
          const left = (span.startMs / durationMs) * 100;
          const endMs = span.endMs ?? durationMs;
          const width = Math.max(
            span.kind === "mark"
              ? 0
              : ((endMs - span.startMs) / durationMs) * 100,
            span.kind === "mark" ? 0 : 0.25,
          );
          const matchesSearch =
            !searchTerm || span.name.toLowerCase().includes(searchTerm);

          if (span.kind === "mark") {
            return (
              <button
                key={span.id}
                type="button"
                aria-label={`${span.name} at ${formatMilliseconds(span.startMs)}`}
                className={cn(
                  "absolute inset-y-1 z-20 w-1 -translate-x-1/2 rounded-full border-l-2 border-primary outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !matchesSearch && "opacity-20",
                )}
                style={{
                  left: `${left}%`,
                  borderColor: LANE_COLOR_VALUES[lane],
                  backgroundColor: LANE_COLOR_VALUES[lane],
                }}
                onMouseEnter={(event) =>
                  onHover({
                    span,
                    clientX: event.clientX,
                    clientY: event.clientY,
                  })
                }
                onMouseMove={(event) =>
                  onHover({
                    span,
                    clientX: event.clientX,
                    clientY: event.clientY,
                  })
                }
                onMouseLeave={() => onHover(null)}
              />
            );
          }

          return (
            <button
              key={span.id}
              type="button"
              aria-label={`${span.name}, ${formatMilliseconds(endMs - span.startMs)}`}
              className={cn(
                "absolute h-4 min-w-1 rounded-sm border border-background/20 outline-none transition-opacity hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring",
                span.status === "error" && "border-destructive",
                !matchesSearch && "opacity-15",
              )}
              style={{
                left: `${left}%`,
                top: track * 22 + 8,
                width: `${width}%`,
                backgroundColor: LANE_COLOR_VALUES[lane],
              }}
              onMouseEnter={(event) =>
                onHover({
                  span,
                  clientX: event.clientX,
                  clientY: event.clientY,
                })
              }
              onMouseMove={(event) =>
                onHover({
                  span,
                  clientX: event.clientX,
                  clientY: event.clientY,
                })
              }
              onMouseLeave={() => onHover(null)}
            />
          );
        })}
      </div>
    </div>
  );
}

function TraceTimeline({
  trace,
  searchTerm,
}: {
  trace: ReaderPerformanceTrace;
  searchTerm: string;
}): React.ReactNode {
  const [hovered, setHovered] = useState<HoveredSpan | null>(null);
  const durationMs = getTraceDuration(trace);
  const guides = getTimelineGuides(trace);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <div className="min-w-[55rem]">
          <div className="grid h-9 grid-cols-[8.5rem_minmax(48rem,1fr)] border-b border-border/60 text-[10px] text-muted-foreground">
            <div className="flex items-center border-r border-border/60 px-3 uppercase tracking-wider">
              Duration
            </div>
            <div className="flex items-center justify-between">
              {[0, 25, 50, 75, 100].map((percent) => (
                <span
                  key={percent}
                  className={cn(
                    "px-1",
                    percent === 100 ? "text-right" : "text-left",
                  )}
                >
                  {formatMilliseconds((durationMs * percent) / 100)}
                </span>
              ))}
            </div>
          </div>

          <div className="grid min-h-9 grid-cols-[8.5rem_minmax(48rem,1fr)] border-b border-border/60 text-[10px] text-muted-foreground">
            <div className="flex items-center border-r border-border/60 px-3 uppercase tracking-wider">
              Milestones
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 py-1.5">
              {guides.map((guide) => (
                <span
                  key={`${guide.span.id}:${guide.label}`}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <span
                    className="h-3 border-l-2 border-dotted"
                    style={{ borderColor: guide.color }}
                    aria-hidden="true"
                  />
                  {guide.label} · {formatMilliseconds(guide.atMs)}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-[8.5rem] right-0 z-30">
              {guides.map((guide) => (
                <button
                  key={`${guide.span.id}:${guide.label}`}
                  type="button"
                  aria-label={`${guide.label} at ${formatMilliseconds(guide.atMs)}`}
                  className="pointer-events-auto absolute inset-y-0 w-3 -translate-x-1/2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ left: `${(guide.atMs / durationMs) * 100}%` }}
                  onMouseEnter={(event) =>
                    setHovered({
                      span: guide.span,
                      clientX: event.clientX,
                      clientY: event.clientY,
                    })
                  }
                  onMouseMove={(event) =>
                    setHovered({
                      span: guide.span,
                      clientX: event.clientX,
                      clientY: event.clientY,
                    })
                  }
                  onMouseLeave={() => setHovered(null)}
                >
                  <span
                    className="absolute inset-y-0 left-1/2 border-l-2 border-dotted opacity-70"
                    style={{ borderColor: guide.color }}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>

            {READER_TRACE_LANES.map((lane) => (
              <TimelineLane
                key={lane}
                lane={lane}
                spans={trace.spans.filter((span) => span.lane === lane)}
                durationMs={durationMs}
                searchTerm={searchTerm}
                onHover={setHovered}
              />
            ))}
          </div>
        </div>
      </div>
      {hovered && <SpanTooltip hovered={hovered} />}
    </div>
  );
}

function TraceMetadata({
  trace,
}: {
  trace: ReaderPerformanceTrace;
}): React.ReactNode {
  const firstSpreadFrameMs = getFirstSpreadFrameMs(trace);
  const settledContentPaintMs = getSettledContentPaintMs(trace);
  const durationMs = getTraceDuration(trace);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">First spread frame</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">
          {firstSpreadFrameMs === null
            ? "Pending"
            : formatMilliseconds(firstSpreadFrameMs)}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Visible content settled</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">
          {settledContentPaintMs === null
            ? "Pending"
            : formatMilliseconds(settledContentPaintMs)}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Full pagination trace</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">
          {formatMilliseconds(durationMs)}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">CPU throttle scope</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">
          {formatCpuThrottle(trace)}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Publisher styles</p>
        <p className="mt-1 text-xl font-semibold">
          {trace.metadata.publisherBookStylingEnabled === true ? "On" : "Off"}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Chapter source</p>
        <p className="mt-1 text-xl font-semibold">{getChapterSource(trace)}</p>
      </div>
    </div>
  );
}

function TraceReadinessBreakdown({
  trace,
}: {
  trace: ReaderPerformanceTrace;
}): React.ReactNode {
  const firstSpreadFrameMs = getFirstSpreadFrameMs(trace);
  const assetsSettledMs = getSpanTime(trace, "display-assets-settle", "end");
  const displayReadyMs = getSpanTime(trace, "reader-display-ready");
  const settledContentPaintMs = getSettledContentPaintMs(trace);
  const steps = [
    {
      label: "Visible assets",
      durationMs:
        firstSpreadFrameMs === null || assetsSettledMs === null
          ? null
          : Math.max(0, assetsSettledMs - firstSpreadFrameMs),
      description: "Decode visible EPUB images and wait for document fonts.",
    },
    {
      label: "Ready commit",
      durationMs:
        assetsSettledMs === null || displayReadyMs === null
          ? null
          : Math.max(0, displayReadyMs - assetsSettledMs),
      description: "Commit the display-ready state through React.",
    },
    {
      label: "Paint confirmation",
      durationMs:
        displayReadyMs === null || settledContentPaintMs === null
          ? null
          : Math.max(0, settledContentPaintMs - displayReadyMs),
      description: "Wait two animation frames to confirm the settled paint.",
    },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div>
        <p className="text-sm font-medium">First spread to settled content</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The first spread can contain an image placeholder. Settled content
          confirms that visible assets and the ready-state paint have completed.
        </p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map((step) => (
          <div key={step.label} className="rounded-lg bg-secondary/35 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-medium">{step.label}</p>
              <p className="text-sm font-semibold tabular-nums">
                {step.durationMs === null
                  ? "Pending"
                  : `+${formatMilliseconds(step.durationMs)}`}
              </p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {step.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Copy feedback belongs to one trace; changing selection starts fresh. */
function CopyTraceButton({ trace }: { trace: ReaderPerformanceTrace }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const handleCopyTrace = async () => {
    try {
      await navigator.clipboard.writeText(
        formatTraceDetailsForClipboard(trace),
      );
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  useEffect(() => {
    if (copyStatus === "idle") return;
    const resetTimer = window.setTimeout(() => setCopyStatus("idle"), 2_000);
    return () => window.clearTimeout(resetTimer);
  }, [copyStatus]);

  return (
    <Button variant="outline" onClick={handleCopyTrace} className="sm:w-auto">
      {copyStatus === "copied" ? (
        <Check className="size-4" />
      ) : (
        <ClipboardCopy className="size-4" />
      )}
      {copyStatus === "copied"
        ? "Copied"
        : copyStatus === "error"
          ? "Copy failed"
          : "Copy trace"}
    </Button>
  );
}

export function ReaderTraceViewer(): React.ReactNode {
  const snapshot = useReaderTraceSnapshot();
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(
    snapshot.traces[0]?.id ?? null,
  );
  const [search, setSearch] = useState("");
  const selectedTrace = useMemo(
    () =>
      snapshot.traces.find((trace) => trace.id === selectedTraceId) ??
      snapshot.traces[0] ??
      null,
    [selectedTraceId, snapshot.traces],
  );
  const searchTerm = search.trim().toLowerCase();

  const handleClear = () => {
    if (!window.confirm("Clear all saved reader performance traces?")) return;
    clearReaderTraces();
  };

  return (
    <main className="mx-auto min-h-svh w-full max-w-[96rem] px-4 pb-16 pt-16 md:px-8 md:pt-12">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="size-4" aria-hidden="true" />
              Reader diagnostics
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Loading traces
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Measure tap-to-first-paint and the background work which completes
              full-book pagination. Traces stay in this browser.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex h-10 items-center gap-3 rounded-full border border-border bg-card px-4 text-sm">
              Record reader traces
              <Switch
                checked={snapshot.recordingEnabled}
                onCheckedChange={setReaderTraceRecordingEnabled}
                aria-label="Record reader traces"
              />
            </label>
            <Button
              variant="outline"
              onClick={handleClear}
              disabled={snapshot.traces.length === 0}
            >
              <Trash2 className="size-4" />
              Clear
            </Button>
          </div>
        </header>

        {snapshot.traces.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <p className="font-medium">No reader traces yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Turn on recording, return to the Library, and open a book.
            </p>
          </div>
        ) : (
          <div className="grid min-w-0 gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
            <aside className="min-w-0">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Saved traces
              </p>
              <div className="flex gap-2 overflow-x-auto pb-2 xl:flex-col xl:overflow-visible">
                {snapshot.traces.map((trace) => {
                  const firstPaintMs = getSettledContentPaintMs(trace);
                  return (
                    <button
                      key={trace.id}
                      type="button"
                      onClick={() => setSelectedTraceId(trace.id)}
                      className={cn(
                        "min-w-64 rounded-xl border border-border bg-card p-3 text-left outline-none transition-colors hover:bg-secondary/45 focus-visible:ring-2 focus-visible:ring-ring xl:min-w-0",
                        selectedTrace?.id === trace.id &&
                          "border-foreground/25 bg-secondary/60",
                      )}
                    >
                      <span className="block truncate text-sm font-medium">
                        {trace.bookTitle ?? trace.bookId}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {formatTraceTimestamp(trace.startedAt)}
                      </span>
                      <span className="mt-2 flex items-center justify-between text-xs tabular-nums">
                        <span>
                          {firstPaintMs === null
                            ? trace.status
                            : `${formatMilliseconds(firstPaintMs)} paint`}
                        </span>
                        <span className="text-muted-foreground">
                          {trace.metadata.mainThreadCpuThrottleRate
                            ? `${trace.metadata.mainThreadCpuThrottleRate}× main`
                            : "CPU not recorded"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            {selectedTrace && (
              <section className="min-w-0 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold">
                      {selectedTrace.bookTitle ?? selectedTrace.bookId}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedTrace.source} · {selectedTrace.status} ·{" "}
                      {selectedTrace.spans.length} events
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <CopyTraceButton
                      key={selectedTrace.id}
                      trace={selectedTrace}
                    />
                    <div className="relative w-full sm:w-64">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Find a span"
                        className="pl-9"
                      />
                    </div>
                  </div>
                </div>

                <TraceMetadata trace={selectedTrace} />
                <TraceReadinessBreakdown trace={selectedTrace} />
                <TraceTimeline trace={selectedTrace} searchTerm={searchTerm} />

                <details className="rounded-xl border border-border bg-card p-4 text-sm">
                  <summary className="cursor-pointer font-medium">
                    Run metadata
                  </summary>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {Object.entries(selectedTrace.metadata).map(
                      ([key, value]) => (
                        <div key={key} className="flex justify-between gap-4">
                          <dt className="text-muted-foreground">{key}</dt>
                          <dd className="truncate text-right">
                            {String(value)}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                </details>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
