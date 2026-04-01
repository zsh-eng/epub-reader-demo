import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  PaginationChapterDiagnostics,
  PaginationDiagnostics,
} from "@/lib/pagination";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { InspectorSection } from "./InspectorSection";

interface DebugSectionProps {
  diagnostics: PaginationDiagnostics | null;
  paginationStatus: string;
  totalPages: number;
  viewport: { width: number; height: number };
  sourceLoadWallClockMs: number | null;
  addChapterSendWallClockMs: number | null;
  chapterTimingRows: PaginationChapterDiagnostics[];
  chapterTitles: (index: number) => string;
}

function formatMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(1)}ms`;
}

function KVRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function DebugSection({
  diagnostics,
  paginationStatus,
  totalPages,
  viewport,
  sourceLoadWallClockMs,
  addChapterSendWallClockMs,
  chapterTimingRows,
  chapterTitles,
}: DebugSectionProps) {
  const [chapterTableOpen, setChapterTableOpen] = useState(false);

  return (
    <InspectorSection title="Debug & Diagnostics" defaultOpen={false}>
      <div className="rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed space-y-0.5">
        <KVRow label="Status" value={paginationStatus} />
        <KVRow
          label="Blocks"
          value={String(diagnostics?.blockCount ?? "—")}
        />
        <KVRow
          label="Lines"
          value={String(diagnostics?.lineCount ?? "—")}
        />
        <KVRow label="Pages" value={String(totalPages)} />
        <KVRow
          label="Viewport"
          value={`${Math.round(viewport.width)} × ${Math.round(viewport.height)}`}
        />

        <div className="border-t border-border/50 my-1.5" />

        <KVRow
          label="Stage 1 Parse"
          value={formatMs(diagnostics?.stage1ParseMs)}
        />
        <KVRow
          label="Stage 2 Prepare"
          value={formatMs(diagnostics?.stage2PrepareMs)}
        />
        <KVRow
          label="Stage 3 Layout"
          value={formatMs(diagnostics?.stage3LayoutMs)}
        />
        <KVRow
          label="Pipeline Total"
          value={formatMs(diagnostics?.totalMs)}
        />

        <div className="border-t border-border/50 my-1.5" />

        <KVRow
          label="Source Load"
          value={formatMs(sourceLoadWallClockMs)}
        />
        <KVRow
          label="Last addChapter"
          value={formatMs(addChapterSendWallClockMs)}
        />

        {chapterTimingRows.length > 0 && (
          <>
            <div className="border-t border-border/50 my-1.5" />
            <Collapsible
              open={chapterTableOpen}
              onOpenChange={setChapterTableOpen}
            >
              <CollapsibleTrigger className="flex items-center gap-1 cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                <ChevronRight
                  className="size-2.5 transition-transform duration-200"
                  style={{
                    transform: chapterTableOpen
                      ? "rotate(90deg)"
                      : undefined,
                  }}
                />
                <span>Chapter Timings ({chapterTimingRows.length})</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[500px] text-[10px]">
                    <thead>
                      <tr className="border-b border-border/50 text-left text-muted-foreground">
                        <th className="py-1 pr-2">#</th>
                        <th className="py-1 pr-2">Title</th>
                        <th className="py-1 pr-2 tabular-nums">Pg</th>
                        <th className="py-1 pr-2 tabular-nums">Blk</th>
                        <th className="py-1 pr-2 tabular-nums">Ln</th>
                        <th className="py-1 pr-2 tabular-nums">S1</th>
                        <th className="py-1 pr-2 tabular-nums">S2</th>
                        <th className="py-1 pr-2 tabular-nums">S3</th>
                        <th className="py-1 pr-0 tabular-nums">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chapterTimingRows.map((ch) => (
                        <tr
                          key={ch.chapterIndex}
                          className="border-b border-border/30 last:border-b-0"
                        >
                          <td className="py-1 pr-2 tabular-nums">
                            {ch.chapterIndex + 1}
                          </td>
                          <td className="py-1 pr-2 max-w-[120px] truncate">
                            {chapterTitles(ch.chapterIndex)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {ch.pageCount}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {ch.blockCount}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {ch.lineCount}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatMs(ch.stage1ParseMs)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatMs(ch.stage2PrepareMs)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatMs(ch.stage3LayoutMs)}
                          </td>
                          <td className="py-1 pr-0 tabular-nums">
                            {formatMs(ch.totalMs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </div>
    </InspectorSection>
  );
}
