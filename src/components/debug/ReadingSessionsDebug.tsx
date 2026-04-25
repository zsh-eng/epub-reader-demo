import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  backfillLegacyReadingProgressCheckpoints,
  backfillLegacyReadingProgressSessions,
  db,
  LEGACY_READING_PROGRESS_SESSION_SOURCE,
  READER_V2_READING_SESSION_SOURCE,
  READING_SESSION_IDLE_TIMEOUT_MS,
  type BackfillLegacyReadingProgressCheckpointsBookSummary,
  type BackfillLegacyReadingProgressCheckpointsResult,
  type BackfillLegacyReadingProgressSessionsBookSummary,
  type BackfillLegacyReadingProgressSessionsResult,
  type ReadingSessionSource,
  type SyncedBook,
  type SyncedReadingSession,
} from "@/lib/db";
import { syncService } from "@/lib/sync-service";
import { cn } from "@/lib/utils";
import {
  type Column,
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Database,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const QUERY_KEY = ["debug", "readingSessions"] as const;
const BACKFILL_PREVIEW_QUERY_KEY = [
  "debug",
  "readingSessions",
  "legacyBackfillPreview",
] as const;
const CHECKPOINT_BACKFILL_PREVIEW_QUERY_KEY = [
  "debug",
  "readingCheckpoints",
  "legacyBackfillPreview",
] as const;

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

interface ReadingSessionsDebugData {
  rows: ReadingSessionDebugRow[];
  bookOptions: FilterOption[];
  deviceOptions: FilterOption[];
}

interface FilterOption {
  value: string;
  label: string;
}

interface ReadingSessionDebugRow {
  id: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  source: ReadingSessionSource;
  startedAt: number;
  endedAt: number | null;
  lastActiveAt: number;
  activeMs: number;
  wallMs: number;
  startPosition: string;
  endPosition: string;
  deviceId: string;
  readerInstanceId: string;
  isStaleOpen: boolean;
  searchText: string;
}

function isActiveRecord(record: { _isDeleted?: number }): boolean {
  return record._isDeleted !== 1;
}

function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "-";
  return dateTimeFormatter.format(new Date(timestamp));
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

function formatPosition(spineIndex: number, scrollProgress: number): string {
  const progress = Number.isFinite(scrollProgress) ? scrollProgress : 0;
  return `Ch ${spineIndex + 1} - ${progress.toFixed(1)}%`;
}

function formatSource(source: ReadingSessionSource): string {
  return source === LEGACY_READING_PROGRESS_SESSION_SOURCE
    ? "Legacy"
    : "Reader v2";
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

async function getReadingSessionsDebugData(): Promise<ReadingSessionsDebugData> {
  const [books, sessions] = await Promise.all([
    db.books.filter(isActiveRecord).toArray() as Promise<SyncedBook[]>,
    db.readingSessions.filter(isActiveRecord).toArray() as Promise<
      SyncedReadingSession[]
    >,
  ]);

  const booksById = new Map(books.map((book) => [book.id, book]));
  const now = Date.now();
  const rows = sessions
    .map((session) => {
      const book = booksById.get(session.bookId);
      const practicalEndAt = session.endedAt ?? session.lastActiveAt;
      const bookTitle = book?.title ?? "Missing book";
      const bookAuthor = book?.author ?? "Unknown author";
      const row: ReadingSessionDebugRow = {
        id: session.id,
        bookId: session.bookId,
        bookTitle,
        bookAuthor,
        source: session.source,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        lastActiveAt: session.lastActiveAt,
        activeMs: session.activeMs,
        wallMs: Math.max(0, practicalEndAt - session.startedAt),
        startPosition: formatPosition(
          session.startSpineIndex,
          session.startScrollProgress,
        ),
        endPosition: formatPosition(
          session.endSpineIndex,
          session.endScrollProgress,
        ),
        deviceId: session.deviceId,
        readerInstanceId: session.readerInstanceId,
        isStaleOpen:
          session.endedAt === null &&
          now - session.lastActiveAt > READING_SESSION_IDLE_TIMEOUT_MS,
        searchText: [
          bookTitle,
          bookAuthor,
          session.bookId,
          session.deviceId,
          session.readerInstanceId,
          session.source,
        ]
          .join(" ")
          .toLowerCase(),
      };

      return row;
    })
    .sort((a, b) => b.startedAt - a.startedAt);

  const bookOptions = Array.from(
    new Map(rows.map((row) => [row.bookId, row.bookTitle])).entries(),
    ([value, label]) => ({ value, label }),
  ).sort((a, b) => a.label.localeCompare(b.label));
  const deviceOptions = Array.from(
    new Set(rows.map((row) => row.deviceId)),
    (deviceId) => ({ value: deviceId, label: truncateId(deviceId) }),
  ).sort((a, b) => a.label.localeCompare(b.label));

  return { rows, bookOptions, deviceOptions };
}

function SortableHeader<TData>({
  column,
  title,
  className,
}: {
  column: Column<TData, unknown>;
  title: string;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-2 h-8 px-2", className)}
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {title}
      <ArrowUpDown className="size-3.5" />
    </Button>
  );
}

const columns: ColumnDef<ReadingSessionDebugRow>[] = [
  {
    accessorKey: "bookTitle",
    header: ({ column }) => <SortableHeader column={column} title="Book" />,
    cell: ({ row }) => (
      <div className="max-w-[300px]">
        <div className="truncate font-medium">{row.original.bookTitle}</div>
        <div className="truncate text-xs text-muted-foreground">
          {row.original.bookAuthor}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "source",
    header: "Source",
    cell: ({ row }) => (
      <Badge
        variant={
          row.original.source === READER_V2_READING_SESSION_SOURCE
            ? "default"
            : "secondary"
        }
      >
        {formatSource(row.original.source)}
      </Badge>
    ),
  },
  {
    accessorKey: "startedAt",
    header: ({ column }) => <SortableHeader column={column} title="Started" />,
    cell: ({ row }) => formatDateTime(row.original.startedAt),
  },
  {
    accessorKey: "lastActiveAt",
    header: ({ column }) => <SortableHeader column={column} title="End" />,
    cell: ({ row }) => (
      <div className="space-y-1">
        <div>
          {formatDateTime(row.original.endedAt ?? row.original.lastActiveAt)}
        </div>
        {row.original.endedAt === null && (
          <Badge variant="outline">
            {row.original.isStaleOpen ? "Open stale" : "Open"}
          </Badge>
        )}
      </div>
    ),
  },
  {
    accessorKey: "activeMs",
    header: ({ column }) => (
      <SortableHeader column={column} title="Active" className="ml-auto" />
    ),
    cell: ({ row }) => (
      <div className="text-right font-medium">
        {formatDuration(row.original.activeMs)}
      </div>
    ),
  },
  {
    accessorKey: "wallMs",
    header: ({ column }) => (
      <SortableHeader column={column} title="Span" className="ml-auto" />
    ),
    cell: ({ row }) => (
      <div className="text-right text-muted-foreground">
        {formatDuration(row.original.wallMs)}
      </div>
    ),
  },
  {
    accessorKey: "startPosition",
    header: "Start",
  },
  {
    accessorKey: "endPosition",
    header: "End position",
  },
  {
    accessorKey: "deviceId",
    header: "Device",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {truncateId(row.original.deviceId)}
      </span>
    ),
  },
  {
    accessorKey: "readerInstanceId",
    header: "Instance",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {truncateId(row.original.readerInstanceId)}
      </span>
    ),
  },
];

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function ReadingSessionsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

function BackfillMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function BackfillBookRows({
  summaries,
}: {
  summaries: BackfillLegacyReadingProgressSessionsBookSummary[];
}) {
  if (summaries.length === 0) {
    return (
      <div className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">
        No legacy progress rows are available to import.
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Book</TableHead>
            <TableHead className="text-right">Rows</TableHead>
            <TableHead className="text-right">Sessions</TableHead>
            <TableHead className="text-right">Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summaries.map((summary) => (
            <TableRow key={summary.bookId}>
              <TableCell>
                <div className="max-w-[280px] truncate">
                  {summary.title ?? summary.bookId}
                </div>
              </TableCell>
              <TableCell className="text-right">
                {summary.progressRowsConsidered.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {summary.sessionsGenerated.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {formatDuration(summary.activeMs)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CheckpointBackfillBookRows({
  summaries,
}: {
  summaries: BackfillLegacyReadingProgressCheckpointsBookSummary[];
}) {
  if (summaries.length === 0) {
    return (
      <div className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">
        No legacy progress rows are available to import.
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Book</TableHead>
            <TableHead className="text-right">Rows</TableHead>
            <TableHead className="text-right">Devices</TableHead>
            <TableHead className="text-right">Checkpoints</TableHead>
            <TableHead className="text-right">Latest</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summaries.map((summary) => (
            <TableRow key={summary.bookId}>
              <TableCell>
                <div className="max-w-[280px] truncate">
                  {summary.title ?? summary.bookId}
                </div>
              </TableCell>
              <TableCell className="text-right">
                {summary.progressRowsConsidered.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {summary.devicesConsidered.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {summary.checkpointsGenerated.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {formatDateTime(summary.latestLastRead)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LegacyBackfillDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const previewQuery = useQuery({
    queryKey: BACKFILL_PREVIEW_QUERY_KEY,
    queryFn: () => backfillLegacyReadingProgressSessions({ dryRun: true }),
    enabled: open,
    staleTime: 0,
  });
  const importMutation = useMutation({
    mutationFn: () => backfillLegacyReadingProgressSessions(),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: BACKFILL_PREVIEW_QUERY_KEY }),
      ]);
      toast({
        title: "Legacy sessions imported",
        description: `${result.sessionsGenerated.toLocaleString()} sessions generated from ${result.progressRowsConsidered.toLocaleString()} progress rows`,
      });
      onOpenChange(false);
    },
    onError: (error) => {
      console.error("Failed to import legacy reading sessions:", error);
      toast({
        title: "Import failed",
        description: "Could not import legacy reading progress",
        variant: "destructive",
      });
    },
  });
  const preview = previewQuery.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Legacy Progress</DialogTitle>
          <DialogDescription>
            This replaces previously imported legacy sessions only. Reader v2
            sessions are left untouched.
          </DialogDescription>
        </DialogHeader>

        {previewQuery.isLoading && <ReadingSessionsSkeleton />}

        {previewQuery.error && (
          <div className="rounded-lg border border-destructive/50 px-4 py-3 text-sm text-destructive">
            Failed to preview the legacy import.
          </div>
        )}

        {preview && <BackfillPreview preview={preview} />}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={importMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={
              importMutation.isPending ||
              previewQuery.isLoading ||
              previewQuery.isError
            }
          >
            {importMutation.isPending && (
              <RefreshCw className="size-4 animate-spin" />
            )}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BackfillPreview({
  preview,
}: {
  preview: BackfillLegacyReadingProgressSessionsResult;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BackfillMetric
          label="Progress rows"
          value={preview.progressRowsConsidered.toLocaleString()}
        />
        <BackfillMetric
          label="Skipped rows"
          value={preview.progressRowsSkipped.toLocaleString()}
        />
        <BackfillMetric
          label="Sessions"
          value={preview.sessionsGenerated.toLocaleString()}
        />
        <BackfillMetric
          label="Active time"
          value={formatDuration(preview.activeMs)}
        />
      </div>
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {preview.existingLegacySessions.toLocaleString()} existing legacy
        session{preview.existingLegacySessions === 1 ? "" : "s"} will be
        replaced.
      </div>
      <BackfillBookRows summaries={preview.bookSummaries} />
    </div>
  );
}

function CheckpointBackfillPreview({
  preview,
}: {
  preview: BackfillLegacyReadingProgressCheckpointsResult;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BackfillMetric
          label="Progress rows"
          value={preview.progressRowsConsidered.toLocaleString()}
        />
        <BackfillMetric
          label="Skipped rows"
          value={preview.progressRowsSkipped.toLocaleString()}
        />
        <BackfillMetric
          label="Checkpoints"
          value={preview.checkpointsGenerated.toLocaleString()}
        />
        <BackfillMetric
          label="Existing"
          value={preview.existingCheckpointsOverwritten.toLocaleString()}
        />
      </div>
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {preview.existingCheckpointsOverwritten.toLocaleString()} existing
        checkpoint
        {preview.existingCheckpointsOverwritten === 1 ? "" : "s"} will be
        overwritten.
      </div>
      <CheckpointBackfillBookRows summaries={preview.bookSummaries} />
    </div>
  );
}

function LegacyCheckpointBackfillDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const previewQuery = useQuery({
    queryKey: CHECKPOINT_BACKFILL_PREVIEW_QUERY_KEY,
    queryFn: () => backfillLegacyReadingProgressCheckpoints({ dryRun: true }),
    enabled: open,
    staleTime: 0,
  });
  const importMutation = useMutation({
    mutationFn: async () => {
      const result = await backfillLegacyReadingProgressCheckpoints();

      try {
        await syncService.pushTable("readingCheckpoints");
        return { result, syncError: null as string | null };
      } catch (error) {
        const syncError =
          error instanceof Error ? error.message : "Unknown sync error";
        return { result, syncError };
      }
    },
    onSuccess: async ({ result, syncError }) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: CHECKPOINT_BACKFILL_PREVIEW_QUERY_KEY,
        }),
        queryClient.invalidateQueries({ queryKey: ["readingCheckpoint"] }),
        queryClient.invalidateQueries({ queryKey: ["readingCheckpoints"] }),
      ]);

      if (syncError) {
        toast({
          title: "Checkpoints imported locally",
          description: `Generated ${result.checkpointsGenerated.toLocaleString()} checkpoints, but the sync push failed: ${syncError}`,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Legacy checkpoints imported",
        description: `${result.checkpointsGenerated.toLocaleString()} checkpoints generated from ${result.progressRowsConsidered.toLocaleString()} progress rows`,
      });
      onOpenChange(false);
    },
    onError: (error) => {
      console.error("Failed to import legacy reading checkpoints:", error);
      toast({
        title: "Import failed",
        description: "Could not import legacy reading checkpoints",
        variant: "destructive",
      });
    },
  });
  const preview = previewQuery.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Legacy Checkpoints</DialogTitle>
          <DialogDescription>
            This overwrites reading checkpoints with the latest legacy progress
            row for each book and device.
          </DialogDescription>
        </DialogHeader>

        {previewQuery.isLoading && <ReadingSessionsSkeleton />}

        {previewQuery.error && (
          <div className="rounded-lg border border-destructive/50 px-4 py-3 text-sm text-destructive">
            Failed to preview the checkpoint import.
          </div>
        )}

        {preview && <CheckpointBackfillPreview preview={preview} />}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={importMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={
              importMutation.isPending ||
              previewQuery.isLoading ||
              previewQuery.isError
            }
          >
            {importMutation.isPending && (
              <RefreshCw className="size-4 animate-spin" />
            )}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReadingSessionsDebug() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<
    "all" | ReadingSessionSource
  >("all");
  const [bookFilter, setBookFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [isBackfillDialogOpen, setIsBackfillDialogOpen] = useState(false);
  const [isCheckpointBackfillDialogOpen, setIsCheckpointBackfillDialogOpen] =
    useState(false);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "startedAt", desc: true },
  ]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getReadingSessionsDebugData,
  });

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return (query.data?.rows ?? []).filter((row) => {
      if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
      if (bookFilter !== "all" && row.bookId !== bookFilter) return false;
      if (deviceFilter !== "all" && row.deviceId !== deviceFilter) return false;
      if (normalizedSearch && !row.searchText.includes(normalizedSearch)) {
        return false;
      }
      return true;
    });
  }, [bookFilter, deviceFilter, query.data?.rows, searchQuery, sourceFilter]);

  const summary = useMemo(() => {
    const rows = query.data?.rows ?? [];
    const readerV2 = rows.filter(
      (row) => row.source === READER_V2_READING_SESSION_SOURCE,
    ).length;
    const legacy = rows.length - readerV2;
    const open = rows.filter((row) => row.endedAt === null).length;
    const staleOpen = rows.filter((row) => row.isStaleOpen).length;
    const activeMs = rows.reduce((total, row) => total + row.activeMs, 0);

    return { total: rows.length, readerV2, legacy, open, staleOpen, activeMs };
  }, [query.data?.rows]);

  const table = useReactTable({
    data: filteredRows,
    columns,
    getRowId: (row) => row.id,
    state: {
      sorting,
      pagination,
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  useEffect(() => {
    table.setPageIndex(0);
  }, [bookFilter, deviceFilter, searchQuery, sourceFilter, table]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-10">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
              <Link to="/">
                <ArrowLeft className="size-4" />
                Back to Library
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold tracking-tight">
              Reading Sessions
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Local debug view for native and legacy-inferred reading sessions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw
                className={cn("size-4", query.isFetching && "animate-spin")}
              />
              Refresh
            </Button>
            <Button onClick={() => setIsBackfillDialogOpen(true)}>
              <Database className="size-4" />
              Import Legacy Progress
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsCheckpointBackfillDialogOpen(true)}
            >
              <Database className="size-4" />
              Import Checkpoints
            </Button>
          </div>
        </header>

        <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatItem
            label="Total sessions"
            value={summary.total.toLocaleString()}
          />
          <StatItem
            label="Reader v2"
            value={summary.readerV2.toLocaleString()}
          />
          <StatItem label="Legacy" value={summary.legacy.toLocaleString()} />
          <StatItem
            label="Open sessions"
            value={
              summary.staleOpen > 0
                ? `${summary.open.toLocaleString()} (${summary.staleOpen} stale)`
                : summary.open.toLocaleString()
            }
          />
          <StatItem
            label="Active time"
            value={formatDuration(summary.activeMs)}
          />
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search book, device, or instance"
                className="pl-9"
              />
            </div>
            <Select
              value={sourceFilter}
              onValueChange={(value) =>
                setSourceFilter(value as "all" | ReadingSessionSource)
              }
            >
              <SelectTrigger className="w-full lg:w-[190px]">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value={READER_V2_READING_SESSION_SOURCE}>
                  Reader v2
                </SelectItem>
                <SelectItem value={LEGACY_READING_PROGRESS_SESSION_SOURCE}>
                  Legacy
                </SelectItem>
              </SelectContent>
            </Select>
            <Select value={bookFilter} onValueChange={setBookFilter}>
              <SelectTrigger className="w-full lg:w-[260px]">
                <SelectValue placeholder="Book" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All books</SelectItem>
                {query.data?.bookOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={deviceFilter} onValueChange={setDeviceFilter}>
              <SelectTrigger className="w-full lg:w-[180px]">
                <SelectValue placeholder="Device" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All devices</SelectItem>
                {query.data?.deviceOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-hidden rounded-xl border bg-background">
            {query.isLoading ? (
              <div className="p-4">
                <ReadingSessionsSkeleton />
              </div>
            ) : query.error ? (
              <div className="p-8 text-center text-sm text-destructive">
                Failed to load reading sessions.
              </div>
            ) : (
              <Table className="min-w-[1180px]">
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead
                          key={header.id}
                          className={cn(
                            header.column.id === "activeMs" ||
                              header.column.id === "wallMs"
                              ? "text-right"
                              : undefined,
                          )}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.length > 0 ? (
                    table.getRowModel().rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={columns.length}
                        className="h-28 text-center text-muted-foreground"
                      >
                        No sessions match the current filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="flex flex-col gap-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <div>
              Showing {table.getRowModel().rows.length.toLocaleString()} of{" "}
              {filteredRows.length.toLocaleString()} filtered session
              {filteredRows.length === 1 ? "" : "s"}
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={`${pagination.pageSize}`}
                onValueChange={(value) =>
                  setPagination((current) => ({
                    ...current,
                    pageIndex: 0,
                    pageSize: Number(value),
                  }))
                }
              >
                <SelectTrigger size="sm" className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize} rows
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronLeft className="size-4" />
                <span className="sr-only">Previous page</span>
              </Button>
              <div className="min-w-24 text-center">
                Page {pagination.pageIndex + 1} of{" "}
                {Math.max(1, table.getPageCount())}
              </div>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <ChevronRight className="size-4" />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <LegacyBackfillDialog
        open={isBackfillDialogOpen}
        onOpenChange={setIsBackfillDialogOpen}
      />
      <LegacyCheckpointBackfillDialog
        open={isCheckpointBackfillDialogOpen}
        onOpenChange={setIsCheckpointBackfillDialogOpen}
      />
    </div>
  );
}
