import type {
  Block,
  PageSlice,
  PaginationConfig,
  PaginationChapterDiagnostics,
  PaginationDiagnostics,
} from "./types";

// ---------------------------------------------------------------------------
// Commands (main thread → worker)
// ---------------------------------------------------------------------------

export interface InitCommand {
  type: "init";
  totalChapters: number;
  config: PaginationConfig;
  initialChapterIndex: number;
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

export interface GetPageCommand {
  type: "getPage";
  globalPage: number;
}

export interface GoToChapterCommand {
  type: "goToChapter";
  chapterIndex: number;
}

export type PaginationCommand =
  | InitCommand
  | AddChapterCommand
  | UpdateConfigCommand
  | GetPageCommand
  | GoToChapterCommand;

// ---------------------------------------------------------------------------
// Events (worker → main thread)
// ---------------------------------------------------------------------------

export interface ReadyEvent {
  type: "ready";
  totalPages: number;
  resolvedPage: number | null;
  slicesChapterIndex: number | null;
  slices: PageSlice[];
  diagnostics: PaginationDiagnostics;
  chapterPageOffsets: number[];
}

export interface PageContentEvent {
  type: "pageContent";
  globalPage: number;
  chapterIndex: number;
  slices: PageSlice[];
}

export interface PageUnavailableEvent {
  type: "pageUnavailable";
  globalPage: number;
}

export interface PartialReadyEvent {
  type: "partialReady";
  chapterIndex: number;
  chapterPageCount: number;
  estimatedTotalPages: number;
  resolvedPage: number | null;
  slicesChapterIndex: number | null;
  slices: PageSlice[];
  chapterPageOffsets: number[];
  chapterDiagnostics: PaginationChapterDiagnostics | null;
}

export interface ProgressEvent {
  type: "progress";
  chapterIndex: number;
  chaptersCompleted: number;
  totalChapters: number;
  runningTotalPages: number;
  chapterPageOffsets: number[];
  chapterDiagnostics: PaginationChapterDiagnostics | null;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type PaginationEvent =
  | ReadyEvent
  | PageContentEvent
  | PageUnavailableEvent
  | PartialReadyEvent
  | ProgressEvent
  | ErrorEvent;
