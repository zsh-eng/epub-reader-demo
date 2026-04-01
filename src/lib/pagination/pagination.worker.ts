import type { PaginationCommand } from "./engine-types";
import { PaginationEngine } from "./pagination-engine";
import {
    coalesceQueuedCommands,
    createCommandRuntime,
    type QueuedPaginationCommand,
} from "./pagination-worker-runtime";

const engine = new PaginationEngine((event) => postMessage(event));

type SchedulerPriority = "user-blocking" | "user-visible" | "background";

interface TaskScheduler {
  postTask?: <T>(
    callback: () => T | PromiseLike<T>,
    options?: { priority?: SchedulerPriority },
  ) => Promise<T>;
}

let pendingCommands: QueuedPaginationCommand[] = [];
let nextCommandSequence = 1;
let latestUpdateConfigSequence = 0;
let flushScheduled = false;
let isFlushing = false;

function isTaskScheduler(value: unknown): value is TaskScheduler {
  return typeof value === "object" && value !== null;
}

async function yieldToEventLoop(): Promise<void> {
  const maybeScheduler = (globalThis as { scheduler?: unknown }).scheduler;
  if (
    isTaskScheduler(maybeScheduler) &&
    typeof maybeScheduler.postTask === "function"
  ) {
    await maybeScheduler.postTask(() => undefined, {
      priority: "background",
    });
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
