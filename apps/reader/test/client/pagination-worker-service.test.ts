import type {
  PaginationWorkerEventMessage,
  PaginationWorkerMessage,
} from "@/lib/pagination-v2/protocol";
import {
  PaginationWorkerService,
  type PaginationWorkerTransport,
} from "@/lib/pagination-v2/worker/pagination-worker-service";
import { describe, expect, it, vi } from "vitest";

class FakePaginationWorker implements PaginationWorkerTransport {
  onmessage:
    | ((event: MessageEvent<PaginationWorkerEventMessage>) => void)
    | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postedMessages: PaginationWorkerMessage[] = [];
  terminate = vi.fn();

  postMessage(message: PaginationWorkerMessage): void {
    this.postedMessages.push(message);
  }

  emit(message: PaginationWorkerEventMessage): void {
    this.onmessage?.({
      data: message,
    } as MessageEvent<PaginationWorkerEventMessage>);
  }
}

describe("PaginationWorkerService", () => {
  it("keeps one warmed worker across Reader sessions", async () => {
    const worker = new FakePaginationWorker();
    const createWorker = vi.fn(() => worker);
    const service = new PaginationWorkerService(createWorker);

    service.warm();
    service.warm();
    expect(createWorker).toHaveBeenCalledTimes(1);

    const firstSession = service.acquireSession({
      onEvent: vi.fn(),
      onError: vi.fn(),
    });
    expect(firstSession.workerFontsReadyAtAcquire).toBe(false);

    const fontsReady = vi.fn();
    firstSession.onWorkerFontsReady(fontsReady);
    worker.emit({
      sessionGeneration: null,
      event: { type: "trace", name: "worker-fonts-ready" },
    });
    expect(fontsReady).toHaveBeenCalledOnce();

    firstSession.release();
    const secondSession = service.acquireSession({
      onEvent: vi.fn(),
      onError: vi.fn(),
    });
    expect(secondSession.workerFontsReadyAtAcquire).toBe(true);

    const alreadyReady = vi.fn();
    secondSession.onWorkerFontsReady(alreadyReady);
    await Promise.resolve();
    expect(alreadyReady).toHaveBeenCalledOnce();
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("stamps commands and drops events from stale sessions", () => {
    const worker = new FakePaginationWorker();
    const service = new PaginationWorkerService(() => worker);
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const firstSession = service.acquireSession({
      onEvent: firstHandler,
      onError: vi.fn(),
    });

    firstSession.postCommand({
      type: "nextSpread",
      intent: { kind: "linear", direction: "forward" },
    });
    expect(worker.postedMessages[0]).toEqual({
      type: "command",
      sessionGeneration: firstSession.sessionGeneration,
      command: {
        type: "nextSpread",
        intent: { kind: "linear", direction: "forward" },
      },
    });

    const secondSession = service.acquireSession({
      onEvent: secondHandler,
      onError: vi.fn(),
    });
    expect(worker.postedMessages[1]).toEqual({
      type: "cancel",
      sessionGeneration: firstSession.sessionGeneration,
    });

    worker.emit({
      sessionGeneration: firstSession.sessionGeneration,
      event: { type: "pageUnavailable", epoch: 1 },
    });
    worker.emit({
      sessionGeneration: secondSession.sessionGeneration,
      event: { type: "pageUnavailable", epoch: 1 },
    });

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledOnce();

    firstSession.release();
    secondSession.release();
    expect(worker.postedMessages.at(-1)).toEqual({
      type: "cancel",
      sessionGeneration: secondSession.sessionGeneration,
    });
  });
});
