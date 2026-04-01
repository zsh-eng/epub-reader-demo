import type {
  Block,
  PageSlice,
  PaginationConfig,
  PaginationChapterDiagnostics,
  PaginationDiagnostics,
} from "./types";

// ---------------------------------------------------------------------------
// Content anchor — used to preserve reading position across re-layouts
// ---------------------------------------------------------------------------

export interface ContentAnchor {
  chapterIndex: number;
  blockId: string;
}

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
  anchor: ContentAnchor | null;
}

export interface GetPageCommand {
  type: "getPage";
  globalPage: number;
}

export type PaginationCommand =
  | InitCommand
  | AddChapterCommand
  | UpdateConfigCommand
  | GetPageCommand;

// ---------------------------------------------------------------------------
// Events (worker → main thread)
// ---------------------------------------------------------------------------

export interface ReadyEvent {
  type: "ready";
  totalPages: number;
  anchorPage: number | null;
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
  anchorPage: number | null;
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
