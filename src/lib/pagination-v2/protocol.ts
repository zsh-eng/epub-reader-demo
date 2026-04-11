import type { PaginationChapterDiagnostics } from "./shared/types";
import type {
    Block,
    ContentAnchor,
    PaginationConfig,
    ResolvedSpread,
    SpreadConfig,
    SpreadIntent,
} from "./types";

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

// ---------------------------------------------------------------------------
// Events (worker → main thread)
// All events carry the `epoch` so the hook can discard stale responses.
// ---------------------------------------------------------------------------

export interface PartialReadyEvent extends PaginationEventMetadata {
  type: "partialReady";
  epoch: number;
  spread: ResolvedSpread;
  chapterDiagnostics: PaginationChapterDiagnostics | null;
}

export interface ReadyEvent extends PaginationEventMetadata {
  type: "ready";
  epoch: number;
  spread: ResolvedSpread;
  chapterDiagnostics: PaginationChapterDiagnostics[];
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

export interface PageContentEvent extends PaginationEventMetadata {
  type: "pageContent";
  epoch: number;
  spread: ResolvedSpread;
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

export type PaginationEvent =
  | PartialReadyEvent
  | ReadyEvent
  | ProgressEvent
  | PageContentEvent
  | PageUnavailableEvent
  | ChapterUnavailableEvent
  | ErrorEvent;
