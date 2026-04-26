import {
  getBookChapterSourceCache,
  getBookFilesByPaths,
  putBookChapterSourceCache,
  type BookChapterSourceCacheEntry,
  type BookFile,
} from "@/lib/db";
import {
  buildReaderChapterCachedContent,
  type ReaderChapterCachedContent,
} from "./chapter-content-pipeline";
import type { ChapterEntry } from "../types";

export const READER_BODY_CACHE_SCHEMA_VERSION = 1;

export interface ReaderBodyCacheData {
  chapterContentsByPath: Map<string, ReaderChapterCachedContent>;
}

function readCachedChapterContents(
  chaptersByPath: Record<string, BookChapterSourceCacheEntry>,
  chapterEntries: ChapterEntry[],
): Map<string, ReaderChapterCachedContent> {
  const chapterContentsByPath = new Map<string, ReaderChapterCachedContent>();
  for (const chapter of chapterEntries) {
    chapterContentsByPath.set(chapter.href, chaptersByPath[chapter.href]!);
  }
  return chapterContentsByPath;
}

async function buildChapterContentsFromFiles(
  chapterEntries: ChapterEntry[],
  allChapterFiles: Map<string, BookFile>,
): Promise<{
  chaptersByPath: Record<string, BookChapterSourceCacheEntry>;
  chapterContentsByPath: Map<string, ReaderChapterCachedContent>;
}> {
  const chaptersByPath: Record<string, BookChapterSourceCacheEntry> = {};
  const chapterContentsByPath = new Map<string, ReaderChapterCachedContent>();

  for (const chapter of chapterEntries) {
    const chapterFile = allChapterFiles.get(chapter.href);
    if (!chapterFile) {
      throw new Error(
        `Missing chapter file for href "${chapter.href}" (chapter ${chapter.index})`,
      );
    }

    const chapterContent = await buildReaderChapterCachedContent({
      source: await chapterFile.content.text(),
      mediaType: chapterFile.mediaType,
      chapter,
    });
    chaptersByPath[chapter.href] = {
      bodyHtml: chapterContent.bodyHtml,
      canonicalText: chapterContent.canonicalText,
    };
    chapterContentsByPath.set(chapter.href, chapterContent);
  }

  return {
    chaptersByPath,
    chapterContentsByPath,
  };
}

/**
 * Loads normalized chapter body HTML and canonical text from the persistent
 * cache, rebuilding from EPUB chapter files on the first open or after a schema
 * version/file hash change.
 */
export async function loadReaderBodyCache(options: {
  bookId: string;
  fileHash: string;
  chapterEntries: ChapterEntry[];
}): Promise<ReaderBodyCacheData> {
  const { bookId, fileHash, chapterEntries } = options;
  const cachedChapterSourceRow = await getBookChapterSourceCache(bookId);

  if (
    cachedChapterSourceRow &&
    cachedChapterSourceRow.cacheVersion === READER_BODY_CACHE_SCHEMA_VERSION &&
    cachedChapterSourceRow.fileHash === fileHash
  ) {
    return {
      chapterContentsByPath: readCachedChapterContents(
        cachedChapterSourceRow.chaptersByPath,
        chapterEntries,
      ),
    };
  }

  const allChapterFiles = await getBookFilesByPaths(
    bookId,
    chapterEntries.map((chapter) => chapter.href),
  );
  const builtChapterContents = await buildChapterContentsFromFiles(
    chapterEntries,
    allChapterFiles,
  );

  await putBookChapterSourceCache(
    bookId,
    fileHash,
    builtChapterContents.chaptersByPath,
    READER_BODY_CACHE_SCHEMA_VERSION,
  );

  return {
    chapterContentsByPath: builtChapterContents.chapterContentsByPath,
  };
}
