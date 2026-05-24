import {
  getBookChapterSourceCache,
  getBookFile,
  getBookFilesByPaths,
  putBookChapterSourceCache,
  type BookChapterSourceCacheEntry,
  type BookFile,
} from "@/lib/db";
import type { PublisherFontFace } from "@/lib/pagination-v2";
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
import {
  createPublisherResourceLoader,
  dedupePublisherFontFaces,
} from "../publisher-resources";

export const READER_BODY_CACHE_SCHEMA_VERSION = 4;
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
export type ReaderBodyCacheLoadKind = "cache-hit" | "rebuilt";

export interface ReaderBodyCacheData {
  baseContentByChapter: Map<number, ReaderBaseChapterContent>;
  loadWallClockMs: number;
  loadKind: ReaderBodyCacheLoadKind;
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
  publisherFontFaces: PublisherFontFace[] = [],
): Map<number, ReaderBaseChapterContent> {
  const baseContentByChapter = new Map<number, ReaderBaseChapterContent>();

  for (
    let chapterIndex = 0;
    chapterIndex < chapterEntries.length;
    chapterIndex++
  ) {
    const chapter = chapterEntries[chapterIndex]!;
    const baseContent = loadBaseChapterContent({
      chapterIndex,
      chapterContent: chapterContentsByPath.get(chapter.href)!,
      chapter,
    });
    baseContent.publisherFontFaces = publisherFontFaces;
    baseContentByChapter.set(chapterIndex, baseContent);
  }

  return baseContentByChapter;
}

async function buildChapterContentsFromFiles(
  bookId: string,
  chapterEntries: ChapterEntry[],
  allChapterFiles: Map<string, BookFile>,
  includePublisherResources: boolean,
): Promise<{
  chaptersByPath: Record<string, BookChapterSourceCacheEntry>;
  chapterContentsByPath: Map<string, ReaderChapterCachedContent>;
  publisherFontFaces: PublisherFontFace[];
}> {
  const chaptersByPath: Record<string, BookChapterSourceCacheEntry> = {};
  const chapterContentsByPath = new Map<string, ReaderChapterCachedContent>();
  const loadedResourceFiles = new Map<string, BookFile>();
  const publisherFontFaces: PublisherFontFace[] = [];

  function getTypedContent(file: BookFile): Blob {
    if (file.content.type || !file.mediaType) return file.content;
    return file.content.slice(0, file.content.size, file.mediaType);
  }

  async function loadResource(path: string): Promise<Blob | null> {
    const cachedFile =
      allChapterFiles.get(path) ?? loadedResourceFiles.get(path);
    if (cachedFile) return getTypedContent(cachedFile);

    const file = await getBookFile(bookId, path);
    if (!file) return null;

    loadedResourceFiles.set(path, file);
    return getTypedContent(file);
  }
  const publisherResourceLoader = includePublisherResources
    ? createPublisherResourceLoader(loadResource)
    : undefined;

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
      loadResource,
      includePublisherResources,
      publisherResourceLoader,
    });
    chaptersByPath[chapter.href] = {
      bodyHtml: chapterContent.bodyHtml,
      canonicalText: chapterContent.canonicalText,
      publisherStylesheets: chapterContent.publisherStylesheets,
    };
    publisherFontFaces.push(...(chapterContent.publisherFontFaces ?? []));
    chapterContentsByPath.set(chapter.href, chapterContent);
  }

  return {
    chaptersByPath,
    chapterContentsByPath,
    publisherFontFaces: dedupePublisherFontFaces(publisherFontFaces),
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
  publisherBookStylingEnabled: boolean;
}): Promise<ReaderBodyCacheData> {
  const {
    bookId,
    fileHash,
    chapterEntries,
    publisherBookStylingEnabled,
  } = options;
  const startedAt = performance.now();
  const cachedChapterSourceRow = await getBookChapterSourceCache(bookId);

  if (
    cachedChapterSourceRow &&
    cachedChapterSourceRow.cacheVersion === READER_BODY_CACHE_SCHEMA_VERSION &&
    cachedChapterSourceRow.fileHash === fileHash &&
    (!publisherBookStylingEnabled ||
      cachedChapterSourceRow.publisherResourcesLoaded === true)
  ) {
    const chapterContentsByPath = readCachedChapterContents(
      cachedChapterSourceRow.chaptersByPath,
      chapterEntries,
    );

    return {
      baseContentByChapter: buildBaseContentByChapter(
        chapterEntries,
        chapterContentsByPath,
        cachedChapterSourceRow.publisherFontFaces ?? [],
      ),
      loadWallClockMs: performance.now() - startedAt,
      loadKind: "cache-hit",
    };
  }

  const allChapterFiles = await getBookFilesByPaths(
    bookId,
    chapterEntries.map((chapter) => chapter.href),
  );
  const builtChapterContents = await buildChapterContentsFromFiles(
    bookId,
    chapterEntries,
    allChapterFiles,
    publisherBookStylingEnabled,
  );

  await putBookChapterSourceCache(
    bookId,
    fileHash,
    builtChapterContents.chaptersByPath,
    READER_BODY_CACHE_SCHEMA_VERSION,
    publisherBookStylingEnabled,
    builtChapterContents.publisherFontFaces,
  );

  return {
    baseContentByChapter: buildBaseContentByChapter(
      chapterEntries,
      builtChapterContents.chapterContentsByPath,
      builtChapterContents.publisherFontFaces,
    ),
    loadWallClockMs: performance.now() - startedAt,
    loadKind: "rebuilt",
  };
}

export function buildReaderChapterArtifact(options: {
  baseContent: ReaderBaseChapterContent;
  highlights: Highlight[];
  publisherBookStylingEnabled: boolean;
}): ReaderDecoratedChapterArtifact {
  return decorateChapterContent(options);
}
