import type { PaginationChapterDiagnostics } from "./shared/types";
import type {
  Block,
  ContentAnchor,
  PaginationConfig,
  ResolvedSpread,
  SpreadConfig,
  SpreadIntent,
} from "./types";

export const PAGINATION_WORKER_FONTS_READY_MARK =
  "pagination-worker-fonts-ready";

// ---------------------------------------------------------------------------
// Commands (main thread → worker)
// ---------------------------------------------------------------------------

export interface InitCommand {
  type: "init";
  totalChapters: number;
  paginationConfig: PaginationConfig;
  spreadConfig: SpreadConfig;
  intent?: SpreadIntent;
  initialChapterIndex: number;
  initialChapterProgress?: number;
  initialAnchor?: ContentAnchor;
  initialHighlightId?: string;
  // First chapter's blocks are included so the engine is immediately live.
  firstChapterBlocks: Block[];
}

export interface AddChapterCommand {
  type: "addChapter";
  chapterIndex: number;
  blocks: Block[];
}

export interface UpdateChapterCommand {
  type: "updateChapter";
  chapterIndex: number;
  blocks: Block[];
}

export interface UpdatePaginationConfigCommand {
  type: "updatePaginationConfig";
  paginationConfig: PaginationConfig;
}

export interface UpdateSpreadConfigCommand {
  type: "updateSpreadConfig";
  spreadConfig: SpreadConfig;
}

export interface NextSpreadCommand {
  type: "nextSpread";
  intent: SpreadIntent;
}

export interface PrevSpreadCommand {
  type: "prevSpread";
  intent: SpreadIntent;
}

export interface GoToPageCommand {
  type: "goToPage";
  page: number;
  intent: SpreadIntent;
}

export interface GoToChapterCommand {
  type: "goToChapter";
  chapterIndex: number;
  intent: SpreadIntent;
}

export interface GoToTargetCommand {
  type: "goToTarget";
  chapterIndex: number;
  targetId: string;
  intent: SpreadIntent;
}

export type PaginationCommand =
  | InitCommand
  | AddChapterCommand
  | UpdateChapterCommand
  | UpdatePaginationConfigCommand
  | UpdateSpreadConfigCommand
  | NextSpreadCommand
  | PrevSpreadCommand
  | GoToPageCommand
  | GoToChapterCommand
  | GoToTargetCommand;

interface PaginationEventMetadata {
  intent: SpreadIntent;
}

interface SpreadWindowEventMetadata {
  spread: ResolvedSpread;
  previousSpread: ResolvedSpread | null;
  nextSpread: ResolvedSpread | null;
}

/**
 * Separates worker engine execution from total worker pipeline time. The
 * remaining time includes font waits, scheduler yields, and waits for chapter
 * input from the main thread.
 */
export interface WorkerTiming {
  activeMs: number;
  elapsedMs: number;
  /** Absolute monotonic timestamp taken immediately before postMessage. */
  postedAtEpochMs: number;
}

// ---------------------------------------------------------------------------
// Events (worker → main thread)
// All events carry the `epoch` so the hook can discard stale responses.
// ---------------------------------------------------------------------------

export interface PartialReadyEvent
  extends PaginationEventMetadata, SpreadWindowEventMetadata {
  type: "partialReady";
  epoch: number;
  chapterDiagnostics: PaginationChapterDiagnostics | null;
  workerTiming?: WorkerTiming;
}

export interface ReadyEvent
  extends PaginationEventMetadata, SpreadWindowEventMetadata {
  type: "ready";
  epoch: number;
  chapterDiagnostics: PaginationChapterDiagnostics[];
  workerTiming?: WorkerTiming;
}

export interface ProgressEvent extends PaginationEventMetadata {
  type: "progress";
  epoch: number;
  chaptersCompleted: number;
  totalChapters: number;
  currentPage: number;
  totalPages: number;
  currentSpread: number;
  totalSpreads: number;
  chapterDiagnostics: PaginationChapterDiagnostics | null;
}

export interface PageContentEvent
  extends PaginationEventMetadata, SpreadWindowEventMetadata {
  type: "pageContent";
  epoch: number;
}

export interface PageUnavailableEvent extends PaginationEventMetadata {
  type: "pageUnavailable";
  epoch: number;
}

export interface ChapterUnavailableEvent extends PaginationEventMetadata {
  type: "chapterUnavailable";
  epoch: number;
  chapterIndex: number;
}

export interface ErrorEvent extends PaginationEventMetadata {
  type: "error";
  message: string;
}

export interface TraceEvent {
  type: "trace";
  name: "worker-fonts-ready" | "publisher-fonts-ready";
}

export type PaginationEvent =
  | PartialReadyEvent
  | ReadyEvent
  | ProgressEvent
  | PageContentEvent
  | PageUnavailableEvent
  | ChapterUnavailableEvent
  | ErrorEvent
  | TraceEvent;

// ---------------------------------------------------------------------------
// App-lifetime worker transport
// ---------------------------------------------------------------------------

/**
 * The worker outlives Reader routes, so each command carries the generation of
 * the active book session. A cancel releases the current engine state without
 * terminating the worker or unloading its built-in fonts.
 */
export type PaginationWorkerMessage =
  | {
      type: "command";
      sessionGeneration: number;
      command: PaginationCommand;
    }
  | {
      type: "cancel";
      sessionGeneration: number;
    };

/**
 * A null generation is reserved for worker-lifetime events, such as built-in
 * font readiness. Book-specific events always use their session generation.
 */
export interface PaginationWorkerEventMessage {
  sessionGeneration: number | null;
  event: PaginationEvent;
}
