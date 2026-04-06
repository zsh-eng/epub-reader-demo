import type { PaginationChapterDiagnostics } from "./shared/types";
import type {
  Block,
  ContentAnchor,
  PaginationConfig,
  ResolvedSpread,
  SpreadConfig,
} from "./types";

// ---------------------------------------------------------------------------
// Commands (main thread → worker)
// ---------------------------------------------------------------------------

export interface InitCommand {
  type: "init";
  totalChapters: number;
  paginationConfig: PaginationConfig;
  spreadConfig: SpreadConfig;
  initialChapterIndex: number;
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
}

export interface PrevSpreadCommand {
  type: "prevSpread";
}

export interface GoToPageCommand {
  type: "goToPage";
  page: number;
}

export interface GoToChapterCommand {
  type: "goToChapter";
  chapterIndex: number;
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
  | GoToChapterCommand;

interface PaginationEventMetadata {
  cause: PaginationCommand["type"];
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
