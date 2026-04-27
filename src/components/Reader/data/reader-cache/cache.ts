import {
    getBookChapterSourceCache,
    getBookFilesByPaths,
    putBookChapterSourceCache,
    type BookChapterSourceCacheEntry,
    type BookFile,
} from "@/lib/db";
import type { Highlight } from "@/types/highlight";
import type { ChapterEntry } from "../../types";
import {
    buildReaderChapterCachedContent,
    decorateChapterContent,
    loadBaseChapterContent,
    type ReaderBaseChapterContent,
    type ReaderChapterCachedContent,
    type ReaderDecoratedChapterArtifact,
} from "../chapter-content-pipeline";

export const READER_BODY_CACHE_SCHEMA_VERSION = 1;
export const READER_CHAPTER_ARTIFACTS_SCHEMA_VERSION = 1;
export const READER_CHAPTER_ARTIFACTS_GC_MS = 30 * 60 * 1000;

/**
 * Reader startup has two cache layers:
 * 1. Persistent body cache: one local IndexedDB row per book containing
 *    normalized chapter body HTML plus canonical text. This is invalidated by
 *    file hash or body cache schema version and can always be rebuilt from
 *    extracted EPUB files.
 * 2. In-memory chapter artifact cache: one React Query row per decorated
 *    chapter, keyed by the body cache version and that chapter's highlight
 *    signature. The artifact loader fills and reads this cache imperatively.
 */
export interface ReaderBodyCacheData {
  baseContentByChapter: Map<number, ReaderBaseChapterContent>;
  loadWallClockMs: number;
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

function buildBaseContentByChapter(
  chapterEntries: ChapterEntry[],
  chapterContentsByPath: Map<string, ReaderChapterCachedContent>,
): Map<number, ReaderBaseChapterContent> {
  const baseContentByChapter = new Map<number, ReaderBaseChapterContent>();

  for (
    let chapterIndex = 0;
    chapterIndex < chapterEntries.length;
    chapterIndex++
  ) {
    const chapter = chapterEntries[chapterIndex]!;
    baseContentByChapter.set(
      chapterIndex,
      loadBaseChapterContent({
        chapterIndex,
        chapterContent: chapterContentsByPath.get(chapter.href)!,
        chapter,
      }),
    );
  }

  return baseContentByChapter;
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
  const startedAt = performance.now();
  const cachedChapterSourceRow = await getBookChapterSourceCache(bookId);

  if (
    cachedChapterSourceRow &&
    cachedChapterSourceRow.cacheVersion === READER_BODY_CACHE_SCHEMA_VERSION &&
    cachedChapterSourceRow.fileHash === fileHash
  ) {
    const chapterContentsByPath = readCachedChapterContents(
      cachedChapterSourceRow.chaptersByPath,
      chapterEntries,
    );

    return {
      baseContentByChapter: buildBaseContentByChapter(
        chapterEntries,
        chapterContentsByPath,
      ),
      loadWallClockMs: performance.now() - startedAt,
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
    baseContentByChapter: buildBaseContentByChapter(
      chapterEntries,
      builtChapterContents.chapterContentsByPath,
    ),
    loadWallClockMs: performance.now() - startedAt,
  };
}

export function buildReaderChapterArtifact(options: {
  baseContent: ReaderBaseChapterContent;
  highlights: Highlight[];
}): ReaderDecoratedChapterArtifact {
  return decorateChapterContent(options);
}
