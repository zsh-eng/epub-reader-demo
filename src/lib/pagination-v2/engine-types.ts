import type { PaginationChapterDiagnostics } from "../pagination/types";
import type { Block, ContentAnchor, PaginationConfig, ResolvedSpread, SpreadConfig } from "./types";

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
  | UpdatePaginationConfigCommand
  | UpdateSpreadConfigCommand
  | NextSpreadCommand
  | PrevSpreadCommand
  | GoToPageCommand
  | GoToChapterCommand;

// ---------------------------------------------------------------------------
// Events (worker → main thread)
// All events carry the `epoch` so the hook can discard stale responses.
// ---------------------------------------------------------------------------

export interface PartialReadyEvent {
  type: "partialReady";
  epoch: number;
  spread: ResolvedSpread;
  chapterDiagnostics: PaginationChapterDiagnostics | null;
}

export interface ReadyEvent {
  type: "ready";
  epoch: number;
  spread: ResolvedSpread;
  chapterDiagnostics: PaginationChapterDiagnostics[];
}

export interface ProgressEvent {
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

export interface PageContentEvent {
  type: "pageContent";
  epoch: number;
  spread: ResolvedSpread;
}

export interface PageUnavailableEvent {
  type: "pageUnavailable";
  epoch: number;
}

export interface ChapterUnavailableEvent {
  type: "chapterUnavailable";
  epoch: number;
  chapterIndex: number;
}

export interface ErrorEvent {
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
