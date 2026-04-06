import type { PaginationCommand } from "../protocol";
import type { PaginationRuntime } from "../engine";

export const RELAYOUT_YIELD_BUDGET_MS = 24;

/** Command coalescing key. Null means command is never coalesced. */
function getCoalesceKey(command: PaginationCommand): string | null {
  switch (command.type) {
    case "updatePaginationConfig":
    case "updateSpreadConfig":
    case "nextSpread":
    case "prevSpread":
    case "goToPage":
    case "goToChapter":
      return command.type;
    case "updateChapter":
      return `${command.type}:${command.chapterIndex}`;
    default:
      return null;
  }
}

/** Command types that advance the layout epoch (require relayout). */
export const LAYOUT_ADVANCING = new Set<PaginationCommand["type"]>([
  "init",
  "updatePaginationConfig",
  "updateChapter",
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
 * Keep only the last occurrence of each coalescable command key.
 * `init` and `addChapter` are never coalesced (always kept in order).
 */
export function coalesceQueuedCommands(
  commands: QueuedPaginationCommand[],
): QueuedPaginationCommand[] {
  const lastIndex = new Map<string, number>();
  for (let i = commands.length - 1; i >= 0; i--) {
    const command = commands[i]?.command;
    if (!command) continue;
    const key = getCoalesceKey(command);
    if (!key || lastIndex.has(key)) continue;
    lastIndex.set(key, i);
  }

  const result: QueuedPaginationCommand[] = [];
  for (let i = 0; i < commands.length; i++) {
    const item = commands[i];
    if (!item) continue;
    const key = getCoalesceKey(item.command);
    if (!key) {
      result.push(item);
      continue;
    }
    if (lastIndex.get(key) === i) result.push(item);
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
 * (updatePaginationConfig / updateChapter / init).
 * Navigation-only commands (nextSpread, prevSpread, etc.) use the no-op runtime.
 */
export function createCommandRuntime(
  cmd: PaginationCommand,
  opts: CreateRuntimeOptions,
): PaginationRuntime {
  if (
    cmd.type !== "updatePaginationConfig" &&
    cmd.type !== "updateChapter" &&
    cmd.type !== "init"
  ) {
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
