import { ReaderTraceViewer } from "@/features/reader/diagnostics/ReaderTraceViewer";
import type { ReaderPerformanceTrace } from "@/lib/reader-performance-trace";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  snapshot: {
    recordingEnabled: false,
    activeTraceId: null,
    traces: [] as ReaderPerformanceTrace[],
  },
}));
vi.mock("@/lib/reader-performance-trace", async (original) => ({
  ...(await original<typeof import("@/lib/reader-performance-trace")>()),
  useReaderTraceSnapshot: () => state.snapshot,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function trace(id: string): ReaderPerformanceTrace {
  return {
    version: 1,
    id,
    bookId: id,
    bookTitle: `Book ${id}`,
    source: "test",
    startedAt: 1000,
    durationMs: 1,
    status: "completed",
    metadata: {},
    spans: [],
  };
}

it("keeps explicit selection and isolates late copy feedback from a replacement trace", async () => {
  state.snapshot = { ...state.snapshot, traces: [trace("A"), trace("B")] };
  const pendingCopy = Promise.withResolvers<void>();
  vi.spyOn(navigator.clipboard, "writeText")
    .mockReturnValueOnce(pendingCopy.promise)
    .mockResolvedValue(undefined);
  const view = render(createElement(ReaderTraceViewer));
  fireEvent.click(screen.getByRole("button", { name: /^Book B/ }));
  fireEvent.click(screen.getByRole("button", { name: "Copy trace" }));
  // A newly recorded trace must not replace the user's selection.
  state.snapshot = {
    ...state.snapshot,
    traces: [trace("C"), ...state.snapshot.traces],
  };
  view.rerender(createElement(ReaderTraceViewer));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    expect.stringContaining("Book B"),
  );
  // Removing that trace derives a fallback and gives it its own copy state.
  state.snapshot = { ...state.snapshot, traces: [trace("C")] };
  view.rerender(createElement(ReaderTraceViewer));
  await act(async () => pendingCopy.resolve());
  expect(screen.getByRole("button", { name: "Copy trace" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copy trace" }));
  await screen.findByRole("button", { name: "Copied" });
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
    expect.stringContaining("Book C"),
  );
});

it("retains the initially selected trace when new recordings arrive", async () => {
  state.snapshot = { ...state.snapshot, traces: [trace("A")] };
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  const view = render(createElement(ReaderTraceViewer));
  state.snapshot = { ...state.snapshot, traces: [trace("B"), trace("A")] };
  view.rerender(createElement(ReaderTraceViewer));
  fireEvent.click(screen.getByRole("button", { name: "Copy trace" }));
  await screen.findByRole("button", { name: "Copied" });
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
    expect.stringContaining("Book A"),
  );
});
