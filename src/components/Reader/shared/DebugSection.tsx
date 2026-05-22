import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  PaginationTracer,
  PaginationTracerSnapshot,
} from "@/lib/pagination-v2";
import { ClipboardCopy, RotateCcw, Upload } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import {
  parseReaderPageDebugDump,
  type ReaderPageDebugDump,
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
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (
    !currentDump &&
    !loadedDump &&
    !onCopyCurrentDump &&
    !onLoadDump
  ) {
    return null;
  }

  const handleLoadDump = () => {
    try {
      const dump = parseReaderPageDebugDump(draft);
      onLoadDump?.(dump);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not parse reader debug dump.",
      );
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

        {currentDump ? <DebugDumpSummary dump={currentDump} /> : null}

        {onLoadDump ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Paste a reader page debug dump..."
              className="min-h-24 resize-y bg-background/60 font-mono text-[11px]"
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={draft.trim().length === 0}
                onClick={handleLoadDump}
              >
                <Upload className="size-3" />
                Load
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

        {loadedDump ? (
          <div className="space-y-1">
            <span className="text-muted-foreground">Loaded Dump</span>
            <DebugDumpSummary dump={loadedDump} />
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
