import type {
  Block,
  FontConfig,
  LayoutTheme,
  PageSlice,
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
  fontConfig: FontConfig;
  layoutTheme: LayoutTheme;
  viewport: { width: number; height: number };
  initialChapterIndex: number;
}

export interface AddChapterCommand {
  type: "addChapter";
  chapterIndex: number;
  blocks: Block[];
}

export interface SetFontConfigCommand {
  type: "setFontConfig";
  fontConfig: FontConfig;
  anchor: ContentAnchor | null;
}

export interface SetViewportCommand {
  type: "setViewport";
  width: number;
  height: number;
  anchor: ContentAnchor | null;
}

export interface SetLayoutThemeCommand {
  type: "setLayoutTheme";
  layoutTheme: LayoutTheme;
  anchor: ContentAnchor | null;
}

export interface GetPageCommand {
  type: "getPage";
  globalPage: number;
}

export type PaginationCommand =
  | InitCommand
  | AddChapterCommand
  | SetFontConfigCommand
  | SetViewportCommand
  | SetLayoutThemeCommand
  | GetPageCommand;

// ---------------------------------------------------------------------------
// Events (worker → main thread)
// ---------------------------------------------------------------------------

export interface ReadyEvent {
  type: "ready";
  totalPages: number;
  anchorPage: number | null;
  slices: PageSlice[];
  diagnostics: PaginationDiagnostics;
  chapterPageOffsets: number[];
}

export interface PageContentEvent {
  type: "pageContent";
  globalPage: number;
  slices: PageSlice[];
}

export interface PartialReadyEvent {
  type: "partialReady";
  chapterIndex: number;
  chapterPageCount: number;
  estimatedTotalPages: number;
  anchorPage: number | null;
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
  | PartialReadyEvent
  | ProgressEvent
  | ErrorEvent;
