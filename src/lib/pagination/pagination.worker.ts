import type { PaginationCommand, PaginationEvent } from "./engine-types";
import { PaginationEngine } from "./pagination-engine";
import { normalizePaginationRevision } from "./pagination-revision";
import { ensurePaginationWorkerFontsReady } from "./pagination-worker-fonts";
import {
  coalesceQueuedCommands,
  createCommandRuntime,
  type QueuedPaginationCommand,
} from "./pagination-worker-runtime";

const workerFontsReady = ensurePaginationWorkerFontsReady();

type SchedulerPriority = "user-blocking" | "user-visible" | "background";

interface TaskScheduler {
  postTask?: <T>(
    callback: () => T | PromiseLike<T>,
    options?: { priority?: SchedulerPriority },
  ) => Promise<T>;
}

let pendingCommands: QueuedPaginationCommand[] = [];
let latestLayoutRevision = 0;
let activeCommandRevision = 0;
let flushScheduled = false;
let isFlushing = false;

function emitEvent(event: PaginationEvent): void {
  const eventWithRevision: PaginationEvent = {
    ...event,
    revision: activeCommandRevision,
  };
  postMessage(eventWithRevision);
}

const engine = new PaginationEngine(emitEvent);

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
    await workerFontsReady;

    while (pendingCommands.length > 0) {
      const batch = coalesceQueuedCommands(pendingCommands);
      pendingCommands = [];

      for (const queuedCommand of batch) {
        const runtime = createCommandRuntime({
          queuedCommand,
          getLatestLayoutRevision: () => latestLayoutRevision,
          yieldToEventLoop,
          now: () => performance.now(),
        });

        activeCommandRevision = queuedCommand.revision;
        await engine.handleCommand(queuedCommand.command, runtime);
        activeCommandRevision = latestLayoutRevision;
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
  const revision = normalizePaginationRevision(e.data.revision, 0);
  const command: PaginationCommand = {
    ...e.data,
    revision,
  };
  const queuedCommand: QueuedPaginationCommand = {
    revision,
    command,
  };

  if (command.type === "init" || command.type === "updateConfig") {
    latestLayoutRevision = Math.max(latestLayoutRevision, revision);
  }

  pendingCommands.push(queuedCommand);
  scheduleFlush();
};
