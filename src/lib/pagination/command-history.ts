import type { ContentAnchor, PaginationCommand } from "./engine-types";

export interface PaginationCommandHistoryEntry {
  id: string;
  timestampMs: number;
  type: PaginationCommand["type"];
  summary: string;
}

export const MAX_PAGINATION_COMMAND_HISTORY = 200;

function summarizeAnchor(anchor: ContentAnchor | null): string {
  if (!anchor) return "none";

  const maxBlockIdLength = 24;
  if (anchor.blockId.length <= maxBlockIdLength) {
    return `ch${anchor.chapterIndex + 1}:${anchor.blockId}`;
  }

  const shortBlockId = `${anchor.blockId.slice(0, maxBlockIdLength)}...`;
  return `ch${anchor.chapterIndex + 1}:${shortBlockId}`;
}

export function summarizePaginationCommand(command: PaginationCommand): string {
  switch (command.type) {
    case "init":
      return `chapters=${command.totalChapters}, initial=${command.initialChapterIndex + 1}, viewport=${Math.round(command.viewport.width)}x${Math.round(command.viewport.height)}`;
    case "addChapter":
      return `chapter=${command.chapterIndex + 1}, blocks=${command.blocks.length}`;
    case "setFontConfig":
      return `base=${command.fontConfig.baseSizePx.toFixed(1)}px, anchor=${summarizeAnchor(command.anchor)}`;
    case "setViewport":
      return `viewport=${Math.round(command.width)}x${Math.round(command.height)}, anchor=${summarizeAnchor(command.anchor)}`;
    case "setLayoutTheme":
      return `lineHeight=${command.layoutTheme.lineHeightFactor.toFixed(2)}, para=${command.layoutTheme.paragraphSpacingFactor.toFixed(2)}, align=${command.layoutTheme.textAlign}, anchor=${summarizeAnchor(command.anchor)}`;
    case "getPage":
      return `page=${command.globalPage}`;
  }
}

export function createPaginationCommandHistoryEntry(
  command: PaginationCommand,
  sequence: number,
  timestampMs = Date.now(),
): PaginationCommandHistoryEntry {
  return {
    id: `cmd-${timestampMs}-${sequence}`,
    timestampMs,
    type: command.type,
    summary: summarizePaginationCommand(command),
  };
}

export function nextPaginationCommandHistory(
  previous: PaginationCommandHistoryEntry[],
  command: PaginationCommand,
  sequence: number,
  timestampMs = Date.now(),
): PaginationCommandHistoryEntry[] {
  const entry = createPaginationCommandHistoryEntry(
    command,
    sequence,
    timestampMs,
  );

  if (command.type === "init") {
    return [entry];
  }

  if (previous.length >= MAX_PAGINATION_COMMAND_HISTORY) {
    return [entry, ...previous.slice(0, MAX_PAGINATION_COMMAND_HISTORY - 1)];
  }

  return [entry, ...previous];
}
