import { useReadingStatus } from "@/hooks/use-reading-status";
import type { ReadingStatus } from "@/lib/db";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

interface ReaderStatusPrompt {
  title: string;
  description: string;
  actionLabel: string;
}

export function getReaderStatusPrompt(
  status: ReadingStatus | null,
): ReaderStatusPrompt | null {
  if (status === "dnf") {
    return {
      title: "Giving this book another try?",
      description: "Move it back to Reading and continue where you left off.",
      actionLabel: "Start again",
    };
  }

  if (status === null || status === "want-to-read") {
    return {
      title: "Ready to start reading?",
      description: "Mark this book as Reading to track your progress.",
      actionLabel: "Start reading",
    };
  }

  return null;
}

interface UseReaderStatusPromptOptions {
  bookId: string | undefined;
  isReady: boolean;
}

/** Shows one contextual reading-status action after the opened book is ready. */
export function useReaderStatusPrompt({
  bookId,
  isReady,
}: UseReaderStatusPromptOptions) {
  const { status, isLoading, setStatusAsync } = useReadingStatus(bookId);
  const promptedBookIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!bookId || !isReady || isLoading) return;
    if (promptedBookIdRef.current === bookId) return;

    promptedBookIdRef.current = bookId;
    const prompt = getReaderStatusPrompt(status);
    if (!prompt) return;

    toast(prompt.title, {
      description: prompt.description,
      duration: 8000,
      action: {
        label: prompt.actionLabel,
        onClick: () => {
          void setStatusAsync("reading")
            .then(() => {
              toast.success("Marked as Reading");
            })
            .catch(() => {
              toast.error("Could not update reading status", {
                description: "Please try again.",
              });
            });
        },
      },
    });
  }, [bookId, isLoading, isReady, setStatusAsync, status]);
}
