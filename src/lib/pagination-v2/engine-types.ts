import type { Block, PaginationConfig } from "./types";
import type { ContentAnchor, ResolvedPage } from "./types";
import type { PaginationChapterDiagnostics } from "../pagination/types";

// ---------------------------------------------------------------------------
// Commands (main thread → worker)
// ---------------------------------------------------------------------------

export interface InitCommand {
  type: "init";
  totalChapters: number;
  config: PaginationConfig;
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

export interface UpdateConfigCommand {
  type: "updateConfig";
  config: PaginationConfig;
}

export interface NextPageCommand {
  type: "nextPage";
}

export interface PrevPageCommand {
  type: "prevPage";
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
  | UpdateConfigCommand
  | NextPageCommand
  | PrevPageCommand
  | GoToPageCommand
  | GoToChapterCommand;

// ---------------------------------------------------------------------------
// Events (worker → main thread)
// All events carry the `epoch` so the hook can discard stale responses.
// ---------------------------------------------------------------------------

export interface PartialReadyEvent {
  type: "partialReady";
  epoch: number;
  page: ResolvedPage;
  chapterDiagnostics: PaginationChapterDiagnostics | null;
}

export interface ReadyEvent {
  type: "ready";
  epoch: number;
  page: ResolvedPage;
  chapterDiagnostics: PaginationChapterDiagnostics[];
}

export interface ProgressEvent {
  type: "progress";
  epoch: number;
  chaptersCompleted: number;
  totalChapters: number;
  chapterDiagnostics: PaginationChapterDiagnostics | null;
}

export interface PageContentEvent {
  type: "pageContent";
  epoch: number;
  page: ResolvedPage;
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
