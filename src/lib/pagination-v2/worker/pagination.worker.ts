import { PaginationEngine, type EnginePaginationEvent } from "../engine";
import type { PaginationCommand, PaginationEvent } from "../protocol";
import { ensurePaginationWorkerFontsReady } from "./fonts";
import {
  PaginationJobScheduler,
  type ScheduledPaginationJob,
} from "./scheduler";
import { PAGINATION_TASK_YIELD_BUDGET_MS } from "./scheduler-policy";

const workerFontsReady = ensurePaginationWorkerFontsReady();

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let layoutEpoch = 0;
let activeEventEpoch = 0;
let pumpScheduled = false;
let isPumping = false;

const TASK_YIELD_BUDGET_MS = PAGINATION_TASK_YIELD_BUDGET_MS;

function emitEvent(event: EnginePaginationEvent): void {
  if (event.type === "error") {
    postMessage(event);
    return;
  }

  postMessage({ ...event, epoch: activeEventEpoch } as PaginationEvent);
}

const engine = new PaginationEngine(emitEvent);
const scheduler = new PaginationJobScheduler((command) =>
  engine.createWork(command),
);

// ---------------------------------------------------------------------------
// Event loop helpers
// ---------------------------------------------------------------------------

async function yieldToEventLoop(): Promise<void> {
  const browserScheduler = (
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
  if (typeof browserScheduler?.postTask === "function") {
    await browserScheduler.postTask(() => undefined, {
      priority: "background",
    });
    return;
  }
  if (typeof browserScheduler?.yield === "function") {
    await browserScheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Job epoch stamping
// ---------------------------------------------------------------------------

function prepareJobStep(job: ScheduledPaginationJob): void {
  if (job.startsLayout && job.eventEpoch === null) {
    layoutEpoch++;
    job.eventEpoch = layoutEpoch;
  }

  activeEventEpoch = job.eventEpoch ?? layoutEpoch;
}

// ---------------------------------------------------------------------------
// Task pump
// ---------------------------------------------------------------------------

function schedulePump(): void {
  if (pumpScheduled || isPumping) return;
  pumpScheduled = true;
  setTimeout(() => {
    pumpScheduled = false;
    void pump();
  }, 0);
}

async function pump(): Promise<void> {
  if (isPumping) return;
  isPumping = true;
  let sliceStartedAt = performance.now();

  try {
    await workerFontsReady;

    while (scheduler.hasWork()) {
      scheduler.expandIncomingCommands();

      const job = scheduler.peek();
      if (!job) continue;

      prepareJobStep(job);
      const result = job.work.next();
      if (result.done) scheduler.remove(job);

      if (performance.now() - sliceStartedAt >= TASK_YIELD_BUDGET_MS) {
        await yieldToEventLoop();
        sliceStartedAt = performance.now();
      }
    }
  } finally {
    isPumping = false;
    if (scheduler.hasWork()) schedulePump();
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<PaginationCommand>) => {
  scheduler.pushCommand(e.data);
  schedulePump();
};
