import { PaginationEngine, type EnginePaginationEvent } from "../engine";
import type { PaginationCommand, PaginationEvent } from "../protocol";
import { ensurePublisherFontsReadyFromBlocks } from "../shared/publisher-fonts";
import { ensurePaginationWorkerFontsReady } from "./fonts";
import {
  PaginationJobScheduler,
  type ScheduledPaginationJob,
} from "./scheduler";
import { PAGINATION_TASK_YIELD_BUDGET_MS } from "./scheduler-policy";

const workerFontsReady = ensurePaginationWorkerFontsReady();
let publisherFontsReady: Promise<void> = Promise.resolve();

void workerFontsReady.then(() => {
  postMessage({
    type: "trace",
    name: "worker-fonts-ready",
  } satisfies PaginationEvent);
});

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let layoutEpoch = 0;
let activeEventEpoch = 0;
let pumpScheduled = false;
let isPumping = false;
let workerRunStartedAtMs: number | null = null;
let workerActiveMs = 0;
let currentWorkStepStartedAtMs: number | null = null;

const TASK_YIELD_BUDGET_MS = PAGINATION_TASK_YIELD_BUDGET_MS;

function emitEvent(event: EnginePaginationEvent): void {
  if (event.type === "error") {
    postMessage(event);
    return;
  }

  if (event.type === "partialReady" || event.type === "ready") {
    const now = performance.now();
    const activeMs =
      workerActiveMs +
      (currentWorkStepStartedAtMs === null
        ? 0
        : now - currentWorkStepStartedAtMs);
    postMessage({
      ...event,
      epoch: activeEventEpoch,
      workerTiming: {
        activeMs,
        elapsedMs:
          workerRunStartedAtMs === null ? 0 : now - workerRunStartedAtMs,
        postedAtEpochMs: performance.timeOrigin + now,
      },
    } satisfies PaginationEvent);
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
      await publisherFontsReady;
      scheduler.expandIncomingCommands();

      const job = scheduler.peek();
      if (!job) continue;

      prepareJobStep(job);
      currentWorkStepStartedAtMs = performance.now();
      const result = job.work.next();
      workerActiveMs += performance.now() - currentWorkStepStartedAtMs;
      currentWorkStepStartedAtMs = null;
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
  const command = e.data;
  if (command.type === "init") {
    workerRunStartedAtMs = performance.now();
    workerActiveMs = 0;
    currentWorkStepStartedAtMs = null;
  }

  publisherFontsReady = publisherFontsReady
    .then(() => {
      switch (command.type) {
        case "init":
          return ensurePublisherFontsReadyFromBlocks(
            command.firstChapterBlocks,
          );
        case "addChapter":
        case "updateChapter":
          return ensurePublisherFontsReadyFromBlocks(command.blocks);
        default:
          return undefined;
      }
    })
    .catch((error) => {
      console.warn("[pagination worker] Failed to load publisher fonts", error);
    });

  if (command.type === "init") {
    void publisherFontsReady.then(() => {
      postMessage({
        type: "trace",
        name: "publisher-fonts-ready",
      } satisfies PaginationEvent);
    });
  }

  scheduler.pushCommand(command);
  schedulePump();
};
