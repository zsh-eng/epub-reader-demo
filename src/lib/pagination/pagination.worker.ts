import { PaginationEngine } from "./pagination-engine";
import type { PaginationCommand } from "./engine-types";

const engine = new PaginationEngine((event) => postMessage(event));

// Commands that can be superseded — only the latest of each type matters
const SUPERSEDABLE: Set<PaginationCommand["type"]> = new Set([
  "updateConfig",
  "getPage",
  "goToChapter",
]);

let pendingCommands: PaginationCommand[] = [];
let flushScheduled = false;

function flush() {
  flushScheduled = false;
  const batch = coalesce(pendingCommands);
  pendingCommands = [];

  for (const cmd of batch) {
    engine.handleCommand(cmd);
  }
}

/**
 * Keep only the last occurrence of each supersedable command type.
 * Non-supersedable commands (e.g. `init`, `addChapter`) are always kept, in order.
 */
function coalesce(commands: PaginationCommand[]): PaginationCommand[] {
  // Walk backwards to find the last index of each supersedable type
  const lastIndex = new Map<PaginationCommand["type"], number>();
  for (let i = commands.length - 1; i >= 0; i--) {
    const type = commands[i]!.type;
    if (SUPERSEDABLE.has(type) && !lastIndex.has(type)) {
      lastIndex.set(type, i);
    }
  }

  const result: PaginationCommand[] = [];
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!;
    if (SUPERSEDABLE.has(cmd.type)) {
      // Only keep the last occurrence
      if (lastIndex.get(cmd.type) === i) {
        result.push(cmd);
      }
    } else {
      result.push(cmd);
    }
  }
  return result;
}

self.onmessage = (e: MessageEvent<PaginationCommand>) => {
  pendingCommands.push(e.data);
  if (!flushScheduled) {
    flushScheduled = true;
    setTimeout(flush, 0);
  }
};
