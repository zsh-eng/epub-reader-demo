import type { PaginationCommand } from "./engine-types";
import type { PaginationRuntime } from "./pagination-engine";

export const RELAYOUT_YIELD_BUDGET_MS = 24;

/** Command types where only the last occurrence matters. */
const SUPERSEDABLE = new Set<PaginationCommand["type"]>([
  "updatePaginationConfig",
  "updateSpreadConfig",
  "nextSpread",
  "prevSpread",
  "goToPage",
  "goToChapter",
]);

/** Command types that advance the layout epoch (require relayout). */
export const LAYOUT_ADVANCING = new Set<PaginationCommand["type"]>([
  "init",
  "updatePaginationConfig",
]);

/** Navigation command types — drained at yield boundaries during relayout. */
export const NAVIGATION_COMMANDS = new Set<PaginationCommand["type"]>([
  "nextSpread",
  "prevSpread",
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
  hasPendingLayoutAdvancingCommand?: () => boolean;
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
 * Build a PaginationRuntime for a relayout command
 * (updatePaginationConfig / init).
 * Navigation-only commands (nextSpread, prevSpread, etc.) use the no-op runtime.
 */
export function createCommandRuntime(
  cmd: PaginationCommand,
  opts: CreateRuntimeOptions,
): PaginationRuntime {
  if (cmd.type !== "updatePaginationConfig" && cmd.type !== "init") {
    return NOOP_RUNTIME;
  }

  const {
    getLayoutEpoch,
    activeEpoch,
    hasPendingLayoutAdvancingCommand = () => false,
    yieldToEventLoop,
    now,
    onYield,
    relayoutYieldBudgetMs = RELAYOUT_YIELD_BUDGET_MS,
  } = opts;

  let lastYieldAt = now();

  return {
    // A queued relayout command supersedes the one currently in progress.
    isStale: () =>
      getLayoutEpoch() > activeEpoch || hasPendingLayoutAdvancingCommand(),
    maybeYield: async () => {
      const elapsed = now() - lastYieldAt;
      if (elapsed < relayoutYieldBudgetMs) return;

      await yieldToEventLoop();
      lastYieldAt = now();
      onYield?.();
    },
  };
}
