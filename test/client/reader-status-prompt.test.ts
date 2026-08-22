import {
  getReaderStatusPrompt,
  useReaderStatusPrompt,
} from "@/components/Reader/hooks/use-reader-status-prompt";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  setStatusAsync: vi.fn(async () => undefined),
  useReadingStatus: vi.fn(),
}));

vi.mock("@/hooks/use-reading-status", () => ({
  useReadingStatus: mocks.useReadingStatus,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(mocks.prompt, {
    success: mocks.success,
    error: mocks.error,
  }),
}));

beforeEach(() => {
  mocks.useReadingStatus.mockReturnValue({
    status: null,
    isLoading: false,
    setStatusAsync: mocks.setStatusAsync,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("getReaderStatusPrompt", () => {
  it.each([null, "want-to-read"] as const)(
    "offers to start a book with status %s",
    (status) => {
      expect(getReaderStatusPrompt(status)).toEqual({
        title: "Ready to start reading?",
        description: "Mark this book as Reading to track your progress.",
        actionLabel: "Start reading",
      });
    },
  );

  it("uses a return message for a did-not-finish book", () => {
    expect(getReaderStatusPrompt("dnf")).toEqual({
      title: "Giving this book another try?",
      description: "Move it back to Reading and continue where you left off.",
      actionLabel: "Start again",
    });
  });

  it.each(["reading", "finished"] as const)(
    "does not prompt for status %s",
    (status) => {
      expect(getReaderStatusPrompt(status)).toBeNull();
    },
  );

  it("waits for reader readiness and offers the reading action once", async () => {
    const { rerender } = renderHook(
      ({ isReady }) => useReaderStatusPrompt({ bookId: "book-1", isReady }),
      { initialProps: { isReady: false } },
    );

    expect(mocks.prompt).not.toHaveBeenCalled();
    rerender({ isReady: true });

    await waitFor(() => expect(mocks.prompt).toHaveBeenCalledOnce());
    rerender({ isReady: false });
    rerender({ isReady: true });
    expect(mocks.prompt).toHaveBeenCalledOnce();

    const options = mocks.prompt.mock.calls[0]?.[1] as {
      action: { onClick: () => void };
    };
    act(() => options.action.onClick());

    await waitFor(() =>
      expect(mocks.setStatusAsync).toHaveBeenCalledWith("reading"),
    );
    await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  });
});
