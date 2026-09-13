import { useReadingStatus } from "@/hooks/use-reading-status";
import type { ReadingStatus } from "@/lib/db";
import { createElement, useState } from "react";
import { toast } from "sonner";
import { ReadingStatusChangeMessage } from "@/components/ReadingStatusChangeMessage";

interface ReaderStatusPrompt {
  previousStatus: "want-to-read" | "dnf" | null;
  title: string;
  actionLabel: string;
}

export function getReaderStatusPrompt(
  status: ReadingStatus | null,
): ReaderStatusPrompt | null {
  if (status === "dnf") {
    return {
      previousStatus: status,
      title: "Giving this book another try?",
      actionLabel: "Start again",
    };
  }

  if (status === null || status === "want-to-read") {
    return {
      previousStatus: status,
      title: "Ready to start reading?",
      actionLabel: "Start reading",
    };
  }

  return null;
}

interface UseReaderStatusPromptOptions {
  bookId: string | undefined;
  isReady: boolean;
}

export interface ReaderStatusAction extends ReaderStatusPrompt {
  isPending: boolean;
  error: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

/** Keeps reading-status feedback with the opened Reader, including save errors. */
export function useReaderStatusPrompt({
  bookId,
  isReady,
}: UseReaderStatusPromptOptions): ReaderStatusAction | undefined {
  const { status, isLoading, setStatusAsync } = useReadingStatus(bookId);
  const [dismissedBookId, setDismissedBookId] = useState("");
  const [operation, setOperation] = useState({
    bookId: "",
    pending: false,
    error: "",
  });
  const prompt = getReaderStatusPrompt(status);
  if (!bookId || !isReady || isLoading || dismissedBookId === bookId || !prompt)
    return;

  const isPending = operation.bookId === bookId && operation.pending;
  return {
    ...prompt,
    isPending,
    error: operation.bookId === bookId ? operation.error : "",
    onDismiss: () => setDismissedBookId(bookId),
    onConfirm: () => {
      if (isPending) return;
      setOperation({ bookId, pending: true, error: "" });
      void setStatusAsync("reading")
        .then(() => {
          toast.success(
            createElement(ReadingStatusChangeMessage, {
              previousStatus: status,
              status: "reading",
            }),
          );
          setDismissedBookId(bookId);
          setOperation({ bookId, pending: false, error: "" });
        })
        .catch(() => {
          setOperation({
            bookId,
            pending: false,
            error: "Could not update reading status. Please try again.",
          });
        });
    },
  };
}
