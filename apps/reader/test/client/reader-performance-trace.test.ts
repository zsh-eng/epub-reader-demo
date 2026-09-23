import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("reader performance trace storage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not record while the switch is off", async () => {
    const traceStore = await import("@/lib/reader-performance-trace");

    expect(
      traceStore.beginReaderTrace({
        bookId: "book-1",
        source: "test",
      }),
    ).toBeNull();
    expect(traceStore.getReaderTraceSnapshot().traces).toEqual([]);
  });

  it("persists a completed trace and its spans", async () => {
    const traceStore = await import("@/lib/reader-performance-trace");
    traceStore.setReaderTraceRecordingEnabled(true);
    traceStore.beginReaderTrace({
      bookId: "book-1",
      bookTitle: "Test book",
      source: "test",
    });
    const span = traceStore.startReaderTraceSpan("book-read", "storage");
    vi.advanceTimersByTime(120);
    traceStore.endReaderTraceSpan(span, { cacheHit: true });
    traceStore.completeReaderTrace("completed");

    const [recorded] = traceStore.getReaderTraceSnapshot().traces;
    expect(recorded).toMatchObject({
      bookId: "book-1",
      bookTitle: "Test book",
      status: "completed",
    });
    expect(recorded?.durationMs).toBe(120);
    expect(recorded?.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "book-read",
          status: "ok",
          details: { cacheHit: true },
        }),
      ]),
    );

    const persisted = JSON.parse(
      localStorage.getItem(traceStore.READER_TRACE_STORAGE_KEY) ?? "[]",
    );
    expect(persisted[0].status).toBe("completed");
  });

  it("restores unfinished traces as interrupted", async () => {
    const firstStore = await import("@/lib/reader-performance-trace");
    firstStore.setReaderTraceRecordingEnabled(true);
    firstStore.beginReaderTrace({ bookId: "book-1", source: "test" });
    firstStore.startReaderTraceSpan("pending-work", "processing");
    vi.advanceTimersByTime(500);

    vi.resetModules();
    const restoredStore = await import("@/lib/reader-performance-trace");
    const [restored] = restoredStore.getReaderTraceSnapshot().traces;

    expect(restored?.status).toBe("interrupted");
    expect(
      restored?.spans.find((span) => span.name === "pending-work"),
    ).toMatchObject({ status: "error", details: { interrupted: true } });
  });

  it("records completed Performance API spans at their original time", async () => {
    const traceStore = await import("@/lib/reader-performance-trace");
    traceStore.setReaderTraceRecordingEnabled(true);
    traceStore.beginReaderTrace({ bookId: "book-1", source: "test" });
    const traceStartedAt = performance.now();

    traceStore.recordReaderTraceSpan({
      name: "main-thread-long-task",
      lane: "processing",
      startPerformanceMs: traceStartedAt + 20,
      endPerformanceMs: traceStartedAt + 90,
      details: { durationMs: 70 },
    });

    const [recorded] = traceStore.getReaderTraceSnapshot().traces;
    expect(
      recorded?.spans.find((span) => span.name === "main-thread-long-task"),
    ).toMatchObject({
      startMs: 20,
      endMs: 90,
      details: { durationMs: 70 },
    });
  });
});

it("debug mode stops recording without deleting traces or the recording preference", async () => {
  vi.resetModules();
  localStorage.clear();
  const debug = await import("@/lib/debug-preference");
  const traces = await import("@/lib/reader-performance-trace");
  debug.setDebugEnabled(false);
  traces.setReaderTraceRecordingEnabled(true);
  expect(
    traces.beginReaderTrace({ bookId: "book-1", source: "test" }),
  ).toBeNull();
  debug.setDebugEnabled(true);
  expect(
    traces.beginReaderTrace({ bookId: "book-1", source: "test" }),
  ).not.toBeNull();
  const span = traces.startReaderTraceSpan("pending", "storage");
  debug.setDebugEnabled(false);
  expect(traces.getReaderTraceSnapshot()).toMatchObject({
    recordingEnabled: true,
    activeTraceId: null,
    traces: [{ status: "interrupted", metadata: { reason: "debug-disabled" } }],
  });
  const saved = JSON.stringify(traces.getReaderTraceSnapshot().traces);
  traces.endReaderTraceSpan(span);
  expect(JSON.stringify(traces.getReaderTraceSnapshot().traces)).toBe(saved);
  expect(localStorage.getItem(traces.READER_TRACE_RECORDING_KEY)).toBe("true");
  debug.setDebugEnabled(true);
  expect(
    traces.beginReaderTrace({ bookId: "book-2", source: "test" }),
  ).not.toBeNull();
  traces.completeReaderTrace("completed");
});
