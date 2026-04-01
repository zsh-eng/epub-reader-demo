import type { PaginationCommand } from "./engine-types";
import type { PaginationRuntime } from "./pagination-engine";

export const RELAYOUT_YIELD_BUDGET_MS = 50;

const SUPERSEDABLE: Set<PaginationCommand["type"]> = new Set([
  "updateConfig",
  "getPage",
  "goToChapter",
]);

export interface QueuedPaginationCommand {
  sequence: number;
  command: PaginationCommand;
}

interface CreateCommandRuntimeOptions {
  queuedCommand: QueuedPaginationCommand;
  getLatestUpdateConfigSequence: () => number;
  yieldToEventLoop: () => Promise<void>;
  now: () => number;
  relayoutYieldBudgetMs?: number;
}

const NOOP_RUNTIME: PaginationRuntime = {
  maybeYield: () => {},
  isStale: () => false,
};

/**
 * Keep only the last occurrence of each supersedable command type.
 * Non-supersedable commands (e.g. `init`, `addChapter`) are always kept, in order.
 */
export function coalesceQueuedCommands(
  commands: QueuedPaginationCommand[],
): QueuedPaginationCommand[] {
  const lastIndex = new Map<PaginationCommand["type"], number>();
  for (let i = commands.length - 1; i >= 0; i--) {
    const type = commands[i]?.command.type;
    if (!type) continue;

    if (SUPERSEDABLE.has(type) && !lastIndex.has(type)) {
      lastIndex.set(type, i);
    }
  }

  const result: QueuedPaginationCommand[] = [];
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    if (!command) continue;

    if (SUPERSEDABLE.has(command.command.type)) {
      if (lastIndex.get(command.command.type) === i) {
        result.push(command);
      }
      continue;
    }

    result.push(command);
  }

  return result;
}

export function createCommandRuntime({
  queuedCommand,
  getLatestUpdateConfigSequence,
  yieldToEventLoop,
  now,
  relayoutYieldBudgetMs = RELAYOUT_YIELD_BUDGET_MS,
}: CreateCommandRuntimeOptions): PaginationRuntime {
  if (queuedCommand.command.type !== "updateConfig") {
    return NOOP_RUNTIME;
  }

  let lastYieldAt = now();

  return {
    isStale: () => {
      return queuedCommand.sequence < getLatestUpdateConfigSequence();
    },
    maybeYield: () => {
      const elapsedMs = now() - lastYieldAt;
      if (elapsedMs < relayoutYieldBudgetMs) {
        return;
      }

      return yieldToEventLoop().then(() => {
        lastYieldAt = now();
      });
    },
  };
}
