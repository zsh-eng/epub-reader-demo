import type { PaginationCommand } from "./engine-types";

export interface PaginationCommandHistoryEntry {
  id: string;
  timestampMs: number;
  type: PaginationCommand["type"];
  summary: string;
}

export const MAX_PAGINATION_COMMAND_HISTORY = 50;

export function summarizePaginationCommand(command: PaginationCommand): string {
  switch (command.type) {
    case "init":
      return `chapters=${command.totalChapters}, initial=${command.initialChapterIndex + 1}, viewport=${Math.round(command.config.viewport.width)}x${Math.round(command.config.viewport.height)}`;
    case "addChapter":
      return `chapter=${command.chapterIndex + 1}, blocks=${command.blocks.length}`;
    case "updateConfig":
      return `base=${command.config.fontConfig.baseSizePx.toFixed(1)}px, lineHeight=${command.config.layoutTheme.lineHeightFactor.toFixed(2)}, para=${command.config.layoutTheme.paragraphSpacingFactor.toFixed(2)}, align=${command.config.layoutTheme.textAlign}, viewport=${Math.round(command.config.viewport.width)}x${Math.round(command.config.viewport.height)}`;
    case "getPage":
      return `page=${command.globalPage}`;
    case "goToChapter":
      return `chapter=${command.chapterIndex + 1}`;
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
