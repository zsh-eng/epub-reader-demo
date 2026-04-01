import { PaginationEngine } from "./pagination-engine";
import type { PaginationCommand } from "./engine-types";
import {
  coalesceQueuedCommands,
  createCommandRuntime,
  type QueuedPaginationCommand,
} from "./pagination-worker-runtime";

const engine = new PaginationEngine((event) => postMessage(event));

interface YieldingScheduler {
  yield: () => Promise<void>;
}

let pendingCommands: QueuedPaginationCommand[] = [];
let nextCommandSequence = 1;
let latestUpdateConfigSequence = 0;
let flushScheduled = false;
let isFlushing = false;

function isYieldingScheduler(value: unknown): value is YieldingScheduler {
  if (typeof value !== "object" || value === null) return false;
  if (!("yield" in value)) return false;
  return typeof value.yield === "function";
}

async function yieldToEventLoop(): Promise<void> {
  const maybeScheduler = (globalThis as { scheduler?: unknown }).scheduler;
  if (isYieldingScheduler(maybeScheduler)) {
    await maybeScheduler.yield();
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function scheduleFlush(): void {
  if (flushScheduled) return;

  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    void flush();
  }, 0);
}

async function flush(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;

  try {
    while (pendingCommands.length > 0) {
      const batch = coalesceQueuedCommands(pendingCommands);
      pendingCommands = [];

      for (const queuedCommand of batch) {
        const runtime = createCommandRuntime({
          queuedCommand,
          getLatestUpdateConfigSequence: () => latestUpdateConfigSequence,
          yieldToEventLoop,
          now: () => performance.now(),
        });

        await engine.handleCommand(queuedCommand.command, runtime);
      }
    }
  } finally {
    isFlushing = false;
    if (pendingCommands.length > 0) {
      scheduleFlush();
    }
  }
}

self.onmessage = (e: MessageEvent<PaginationCommand>) => {
  const queuedCommand: QueuedPaginationCommand = {
    sequence: nextCommandSequence,
    command: e.data,
  };
  nextCommandSequence += 1;

  if (queuedCommand.command.type === "updateConfig") {
    latestUpdateConfigSequence = queuedCommand.sequence;
  }

  pendingCommands.push(queuedCommand);
  scheduleFlush();
};
