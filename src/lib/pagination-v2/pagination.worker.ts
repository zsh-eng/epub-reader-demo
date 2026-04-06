import { ensurePaginationWorkerFontsReady } from "./shared/pagination-worker-fonts";
import type { PaginationCommand, PaginationEvent } from "./engine-types";
import { PaginationEngine } from "./pagination-engine";
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
// Each init/updatePaginationConfig bumps layoutEpoch. The engine's .epoch field is set
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

async function yieldToEventLoop(): Promise<void> {
  const scheduler = (
    globalThis as {
      scheduler?: {
        postTask?: (
          callback: () => void,
          options?: {
            priority?: "user-blocking" | "user-visible" | "background";
          },
        ) => Promise<void>;
        yield?: () => Promise<void>;
      };
    }
  ).scheduler;
  if (typeof scheduler?.postTask === "function") {
    await scheduler.postTask(() => undefined, { priority: "background" });
    return;
  }
  if (typeof scheduler?.yield === "function") {
    await scheduler.yield();
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

function hasPendingLayoutAdvancingCommand(): boolean {
  return pendingCommands.some((q) => LAYOUT_ADVANCING.has(q.command.type));
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
          hasPendingLayoutAdvancingCommand,
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
