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
});
