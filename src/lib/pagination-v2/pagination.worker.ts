import type { PaginationCommand, PaginationEvent } from "./engine-types";
import { PaginationEngine } from "./pagination-engine";
import { ensurePaginationWorkerFontsReady } from "../pagination/pagination-worker-fonts";
import {
  coalesceQueuedCommands,
  createCommandRuntime,
  LAYOUT_ADVANCING,
  NAVIGATION_COMMANDS,
  type QueuedPaginationCommand,
} from "./pagination-worker-runtime";

const workerFontsReady = ensurePaginationWorkerFontsReady();

// ---------------------------------------------------------------------------
// Epoch tracking
// Each init/updateConfig bumps layoutEpoch. The engine's .epoch field is set
// to the active epoch before each command so all emitted events carry it.
// The hook discards events from older epochs.
// ---------------------------------------------------------------------------

let layoutEpoch = 0;
let pendingCommands: QueuedPaginationCommand[] = [];
let flushScheduled = false;
let isFlushing = false;

function emitEvent(event: PaginationEvent): void {
  postMessage(event);
}

const engine = new PaginationEngine(emitEvent);

// ---------------------------------------------------------------------------
// Event loop helpers
// ---------------------------------------------------------------------------

type SchedulerPriority = "user-blocking" | "user-visible" | "background";
interface TaskScheduler {
  postTask?: <T>(
    callback: () => T | PromiseLike<T>,
    options?: { priority?: SchedulerPriority },
  ) => Promise<T>;
}

async function yieldToEventLoop(): Promise<void> {
  const maybeScheduler = (globalThis as { scheduler?: unknown }).scheduler;
  if (
    typeof maybeScheduler === "object" &&
    maybeScheduler !== null &&
    typeof (maybeScheduler as TaskScheduler).postTask === "function"
  ) {
    await (maybeScheduler as TaskScheduler).postTask!(() => undefined, {
      priority: "background",
    });
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Navigation drain — called inside maybeYield so navigation commands are
// processed at each yield boundary during a long relayout.
// ---------------------------------------------------------------------------

function drainNavigationCommands(): void {
  const navCommands = pendingCommands.filter((q) =>
    NAVIGATION_COMMANDS.has(q.command.type),
  );
  if (navCommands.length === 0) return;

  // Remove them from the pending queue.
  pendingCommands = pendingCommands.filter(
    (q) => !NAVIGATION_COMMANDS.has(q.command.type),
  );

  // Only the last navigation command is meaningful (they're supersedable).
  const last = navCommands[navCommands.length - 1];
  if (!last) return;

  engine.epoch = layoutEpoch;
  void engine.handleCommand(last.command);
}

// ---------------------------------------------------------------------------
// Flush loop
// ---------------------------------------------------------------------------

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

      for (const queued of batch) {
        const { command } = queued;

        if (LAYOUT_ADVANCING.has(command.type)) {
          layoutEpoch++;
        }

        engine.epoch = layoutEpoch;

        const runtime = createCommandRuntime(command, {
          getLayoutEpoch: () => layoutEpoch,
          activeEpoch: layoutEpoch,
          yieldToEventLoop,
          now: () => performance.now(),
          onYield: drainNavigationCommands,
        });

        await engine.handleCommand(command, runtime);
      }
    }
  } finally {
    isFlushing = false;
    if (pendingCommands.length > 0) scheduleFlush();
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<PaginationCommand>) => {
  pendingCommands.push({ command: e.data });
  scheduleFlush();
};
