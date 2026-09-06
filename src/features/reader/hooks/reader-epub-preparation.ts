import type { Book } from "@/lib/db";

interface ReaderEpubProcessorState {
  isReady: boolean;
  error: Error | null;
}

interface ResolveReaderEpubPreparationOptions {
  bookId?: string;
  book: Book | null;
  isBookLoading: boolean;
  epubProcessor: ReaderEpubProcessorState;
}

interface ReaderEpubPreparation {
  chapterContentBookId: string | undefined;
  chapterContentBook: Book | null;
  isBookLoading: boolean;
  epubProcessError: Error | null;
}

export function resolveReaderEpubPreparation({
  bookId,
  book,
  isBookLoading,
  epubProcessor,
}: ResolveReaderEpubPreparationOptions): ReaderEpubPreparation {
  const canLoadChapterContent = !!book && epubProcessor.isReady;

  return {
    chapterContentBookId: canLoadChapterContent ? bookId : undefined,
    chapterContentBook: canLoadChapterContent ? book : null,
    isBookLoading:
      isBookLoading ||
      (!!book && !epubProcessor.isReady && !epubProcessor.error),
    epubProcessError: epubProcessor.error,
  };
}
