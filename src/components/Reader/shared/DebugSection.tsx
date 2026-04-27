import type {
  PaginationTracer,
  PaginationTracerSnapshot,
} from "@/lib/pagination-v2";
import { useSyncExternalStore } from "react";
import { InspectorSection } from "./InspectorSection";

interface DebugSectionProps {
  tracer: PaginationTracer;
  paginationStatus: string;
  totalPages: number;
  viewport: { width: number; height: number };
  sourceLoadWallClockMs: number | null;
  sourceLoadKind: "cache-hit" | "rebuilt" | null;
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

export function DebugSection({
  tracer,
  paginationStatus,
  totalPages,
  viewport,
  sourceLoadWallClockMs,
  sourceLoadKind,
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
      </div>
    </InspectorSection>
  );
}
