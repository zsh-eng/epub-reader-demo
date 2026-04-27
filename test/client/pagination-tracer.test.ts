import {
  PaginationTracer,
  type PaginationTracerSnapshot,
} from "@/lib/pagination-v2";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("PaginationTracer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks startup timing from init to first visible and ready", () => {
    const tracer = new PaginationTracer();
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(125)
      .mockReturnValueOnce(180);

    tracer.startRun();
    tracer.markFirstVisible();
    tracer.markReady();

    const timings = tracer.getSnapshot().timings;
    expect(timings.timeToFirstVisibleMs).toBe(25);
    expect(timings.timeToReadyMs).toBe(80);
  });

  it("treats ready as first visible for single-chapter runs", () => {
    const tracer = new PaginationTracer();
    vi.spyOn(performance, "now").mockReturnValueOnce(10).mockReturnValueOnce(42);

    tracer.startRun();
    tracer.markReady();

    const timings = tracer.getSnapshot().timings;
    expect(timings.timeToFirstVisibleMs).toBe(32);
    expect(timings.timeToReadyMs).toBe(32);
  });

  it("keeps startup ready timing stable after later ready events", () => {
    const tracer = new PaginationTracer();
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(42)
      .mockReturnValueOnce(500);

    tracer.startRun();
    tracer.markReady();
    tracer.markReady();

    expect(tracer.getSnapshot().timings.timeToReadyMs).toBe(32);
  });

  it("publishes aggregate chapter diagnostics through snapshot subscribers", () => {
    const tracer = new PaginationTracer();
    const notifications: PaginationTracerSnapshot[] = [];

    const unsubscribe = tracer.subscribe(() => {
      notifications.push(tracer.getSnapshot());
    });

    tracer.recordChapterDiagnostics({
      chapterIndex: 0,
      blockCount: 10,
      lineCount: 20,
      pageCount: 2,
      stage2PrepareMs: 3,
      stage3LayoutMs: 5,
    });
    tracer.recordChapterDiagnosticsList([
      {
        chapterIndex: 1,
        blockCount: 4,
        lineCount: 8,
        pageCount: 1,
        stage2PrepareMs: 2,
        stage3LayoutMs: 7,
      },
    ]);

    const diagnostics = tracer.getSnapshot().diagnostics;
    expect(diagnostics?.chapterCount).toBe(2);
    expect(diagnostics?.blockCount).toBe(14);
    expect(diagnostics?.lineCount).toBe(28);
    expect(diagnostics?.stage2PrepareMs).toBe(5);
    expect(diagnostics?.stage3LayoutMs).toBe(12);
    expect(diagnostics?.totalMs).toBe(17);
    expect(notifications).toHaveLength(2);

    unsubscribe();
  });

  it("reset clears diagnostics and current run timings", () => {
    const tracer = new PaginationTracer();
    vi.spyOn(performance, "now").mockReturnValue(100);

    tracer.startRun();
    tracer.recordChapterDiagnostics({
      chapterIndex: 0,
      blockCount: 10,
      lineCount: 20,
      pageCount: 2,
      stage2PrepareMs: 3,
      stage3LayoutMs: 5,
    });

    tracer.reset();

    const snapshot = tracer.getSnapshot();
    expect(snapshot.diagnostics).toBeNull();
    expect(snapshot.timings.startedAtMs).toBeNull();
  });
});
