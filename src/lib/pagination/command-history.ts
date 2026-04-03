import type { PaginationCommand as PaginationV1Command } from "./engine-types";
import type { PaginationCommand as PaginationV2Command } from "../pagination-v2/engine-types";

export type TrackedPaginationCommand = PaginationV1Command | PaginationV2Command;

export interface PaginationCommandHistoryEntry {
  id: string;
  timestampMs: number;
  type: TrackedPaginationCommand["type"];
  summary: string;
}

export const MAX_PAGINATION_COMMAND_HISTORY = 200;

export function summarizePaginationCommand(
  command: TrackedPaginationCommand,
): string {
  switch (command.type) {
    case "init": {
      const viewport = "config" in command
        ? command.config.viewport
        : command.paginationConfig.viewport;
      const spreadInfo =
        "spreadConfig" in command
          ? `, spread=${command.spreadConfig.columns}col/${command.spreadConfig.chapterFlow}`
          : "";
      return `chapters=${command.totalChapters}, initial=${command.initialChapterIndex + 1}, viewport=${Math.round(viewport.width)}x${Math.round(viewport.height)}${spreadInfo}`;
    }
    case "addChapter":
      return `chapter=${command.chapterIndex + 1}, blocks=${command.blocks.length}`;
    case "updateConfig":
      return `base=${command.config.fontConfig.baseSizePx.toFixed(1)}px, lineHeight=${command.config.layoutTheme.lineHeightFactor.toFixed(2)}, para=${command.config.layoutTheme.paragraphSpacingFactor.toFixed(2)}, align=${command.config.layoutTheme.textAlign}, viewport=${Math.round(command.config.viewport.width)}x${Math.round(command.config.viewport.height)}`;
    case "updatePaginationConfig":
      return `base=${command.paginationConfig.fontConfig.baseSizePx.toFixed(1)}px, lineHeight=${command.paginationConfig.layoutTheme.lineHeightFactor.toFixed(2)}, para=${command.paginationConfig.layoutTheme.paragraphSpacingFactor.toFixed(2)}, align=${command.paginationConfig.layoutTheme.textAlign}, viewport=${Math.round(command.paginationConfig.viewport.width)}x${Math.round(command.paginationConfig.viewport.height)}`;
    case "updateSpreadConfig":
      return `spread=${command.spreadConfig.columns}col/${command.spreadConfig.chapterFlow}`;
    case "getPage":
      return `page=${command.globalPage}`;
    case "goToPage":
      return `page=${command.page}`;
    case "goToChapter":
      return `chapter=${command.chapterIndex + 1}`;
    case "nextSpread":
      return "next-spread";
    case "prevSpread":
      return "prev-spread";
  }
}

export function createPaginationCommandHistoryEntry(
  command: TrackedPaginationCommand,
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
  command: TrackedPaginationCommand,
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
