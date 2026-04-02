import type {
  Block,
  PageSlice,
  PaginationConfig,
  PaginationChapterDiagnostics,
  PaginationDiagnostics,
  TextCursorOffset,
} from "./types";

// ---------------------------------------------------------------------------
// Commands (main thread → worker)
// ---------------------------------------------------------------------------

export interface ContentAnchor {
  chapterIndex: number;
  blockId: string;
  offset?: TextCursorOffset;
}

interface PaginationCommandMetadata {
  revision?: number;
}

interface PaginationEventMetadata {
  revision?: number;
}

export interface InitCommand extends PaginationCommandMetadata {
  type: "init";
  totalChapters: number;
  config: PaginationConfig;
  initialChapterIndex: number;
  initialAnchor?: ContentAnchor | null;
}

export interface AddChapterCommand extends PaginationCommandMetadata {
  type: "addChapter";
  chapterIndex: number;
  blocks: Block[];
}

export interface UpdateConfigCommand extends PaginationCommandMetadata {
  type: "updateConfig";
  config: PaginationConfig;
}

export interface GetPageCommand extends PaginationCommandMetadata {
  type: "getPage";
  globalPage: number;
}

export interface GoToChapterCommand extends PaginationCommandMetadata {
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

export interface ReadyEvent extends PaginationEventMetadata {
  type: "ready";
  totalPages: number;
  resolvedPage: number | null;
  resolvedAnchor: ContentAnchor | null;
  slicesChapterIndex: number | null;
  slices: PageSlice[];
  diagnostics: PaginationDiagnostics;
  chapterPageOffsets: number[];
}

export interface PageContentEvent extends PaginationEventMetadata {
  type: "pageContent";
  globalPage: number;
  chapterIndex: number;
  slices: PageSlice[];
  resolvedAnchor: ContentAnchor | null;
}

export interface PageUnavailableEvent extends PaginationEventMetadata {
  type: "pageUnavailable";
  globalPage: number;
}

export interface PartialReadyEvent extends PaginationEventMetadata {
  type: "partialReady";
  chapterIndex: number;
  chapterPageCount: number;
  estimatedTotalPages: number;
  resolvedPage: number | null;
  resolvedAnchor: ContentAnchor | null;
  slicesChapterIndex: number | null;
  slices: PageSlice[];
  chapterPageOffsets: number[];
  chapterDiagnostics: PaginationChapterDiagnostics | null;
}

export interface ProgressEvent extends PaginationEventMetadata {
  type: "progress";
  chapterIndex: number;
  chaptersCompleted: number;
  totalChapters: number;
  runningTotalPages: number;
  chapterPageOffsets: number[];
  chapterDiagnostics: PaginationChapterDiagnostics | null;
}

export interface ErrorEvent extends PaginationEventMetadata {
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
