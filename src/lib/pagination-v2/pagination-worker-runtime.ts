import type { PaginationCommand } from "./engine-types";
import type { PaginationRuntime } from "./pagination-engine";

export const RELAYOUT_YIELD_BUDGET_MS = 24;

/** Command types where only the last occurrence matters. */
const SUPERSEDABLE = new Set<PaginationCommand["type"]>([
  "updateConfig",
  "nextPage",
  "prevPage",
  "goToPage",
  "goToChapter",
]);

/** Command types that advance the layout epoch (require relayout). */
export const LAYOUT_ADVANCING = new Set<PaginationCommand["type"]>([
  "init",
  "updateConfig",
]);

/** Navigation command types — drained at yield boundaries during relayout. */
export const NAVIGATION_COMMANDS = new Set<PaginationCommand["type"]>([
  "nextPage",
  "prevPage",
  "goToPage",
  "goToChapter",
]);

export interface QueuedPaginationCommand {
  command: PaginationCommand;
}

/**
 * Keep only the last occurrence of each supersedable command type.
 * `init` and `addChapter` are never coalesced (always kept in order).
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
    const item = commands[i];
    if (!item) continue;
    if (SUPERSEDABLE.has(item.command.type)) {
      if (lastIndex.get(item.command.type) === i) result.push(item);
      continue;
    }
    result.push(item);
  }
  return result;
}

interface CreateRuntimeOptions {
  getLayoutEpoch: () => number;
  activeEpoch: number;
  yieldToEventLoop: () => Promise<void>;
  now: () => number;
  onYield?: () => void;
  relayoutYieldBudgetMs?: number;
}

const NOOP_RUNTIME: PaginationRuntime = {
  maybeYield: async () => {},
  isStale: () => false,
};

/**
 * Build a PaginationRuntime for a relayout command (updateConfig / init).
 * Navigation-only commands (nextPage, prevPage, etc.) use the no-op runtime.
 */
export function createCommandRuntime(
  cmd: PaginationCommand,
  opts: CreateRuntimeOptions,
): PaginationRuntime {
  if (cmd.type !== "updateConfig" && cmd.type !== "init") {
    return NOOP_RUNTIME;
  }

  const {
    getLayoutEpoch,
    activeEpoch,
    yieldToEventLoop,
    now,
    onYield,
    relayoutYieldBudgetMs = RELAYOUT_YIELD_BUDGET_MS,
  } = opts;

  let lastYieldAt = now();

  return {
    isStale: () => getLayoutEpoch() > activeEpoch,
    maybeYield: () => {
      const elapsed = now() - lastYieldAt;
      if (elapsed < relayoutYieldBudgetMs) return;

      return yieldToEventLoop().then(() => {
        lastYieldAt = now();
        onYield?.();
      });
    },
  };
}
