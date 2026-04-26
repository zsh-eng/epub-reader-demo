import {
  getBookChapterSourceCache,
  getBookFilesByPaths,
  putBookChapterSourceCache,
  type BookChapterSourceCacheEntry,
  type BookFile,
} from "@/lib/db";
import type { Highlight } from "@/types/highlight";
import {
  buildReaderChapterCachedContent,
  buildReaderChapterLoadOrder,
  decorateChapterContent,
  loadBaseChapterContent,
  type ReaderBaseChapterContent,
  type ReaderChapterCachedContent,
  type ReaderDecoratedChapterArtifact,
} from "../chapter-content-pipeline";
import type { ChapterEntry } from "../../types";

export const READER_BODY_CACHE_SCHEMA_VERSION = 1;
export const READER_CHAPTER_ARTIFACTS_SCHEMA_VERSION = 1;
export const READER_CHAPTER_ARTIFACTS_GC_MS = 30 * 60 * 1000;

/**
 * Reader startup has two cache layers:
 * 1. Persistent body cache: one local IndexedDB row per book containing
 *    normalized chapter body HTML plus canonical text. This is invalidated by
 *    file hash or body cache schema version and can always be rebuilt from
 *    extracted EPUB files.
 * 2. In-memory artifact cache: React Query data derived from the body cache,
 *    current highlights, and the initial chapter. It is invalidated by the
 *    artifact schema version, body cache schema version, file hash, and a
 *    stable highlight signature.
 */
export interface ReaderBodyCacheData {
  chapterContentsByPath: Map<string, ReaderChapterCachedContent>;
  loadWallClockMs: number;
}

export interface ReaderChapterArtifactsData {
  baseContentByChapter: Map<number, ReaderBaseChapterContent>;
  decoratedArtifactByChapter: Map<number, ReaderDecoratedChapterArtifact>;
  artifactsByChapter: (ReaderDecoratedChapterArtifact | null)[];
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
  const startedAt = performance.now();
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
    chapterContentsByPath: builtChapterContents.chapterContentsByPath,
    loadWallClockMs: performance.now() - startedAt,
  };
}

function createEmptyArtifactList(
  chapterCount: number,
): (ReaderDecoratedChapterArtifact | null)[] {
  return Array.from<ReaderDecoratedChapterArtifact | null>({
    length: chapterCount,
  }).fill(null);
}

function getHighlightUpdatedAtValue(highlight: Highlight): number {
  return highlight.updatedAt?.getTime() ?? 0;
}

export function buildReaderArtifactHighlightSignature(
  highlights: Highlight[],
): string {
  if (highlights.length === 0) return "none";

  return JSON.stringify(
    highlights
      .slice()
      .sort((a, b) => {
        if (a.spineItemId !== b.spineItemId) {
          return a.spineItemId.localeCompare(b.spineItemId);
        }
        if (a.startOffset !== b.startOffset) {
          return a.startOffset - b.startOffset;
        }
        if (a.endOffset !== b.endOffset) return a.endOffset - b.endOffset;
        return a.id.localeCompare(b.id);
      })
      .map((highlight) => [
        highlight.spineItemId,
        highlight.id,
        highlight.startOffset,
        highlight.endOffset,
        highlight.color,
        highlight.selectedText,
        getHighlightUpdatedAtValue(highlight),
      ]),
  );
}

export function buildReaderChapterArtifacts(options: {
  bodyCacheData: ReaderBodyCacheData;
  chapterEntries: ChapterEntry[];
  highlightsBySpineItemId: ReadonlyMap<string, Highlight[]>;
  initialChapterIndex: number;
}): ReaderChapterArtifactsData {
  const {
    bodyCacheData,
    chapterEntries,
    highlightsBySpineItemId,
    initialChapterIndex,
  } = options;
  const baseContentByChapter = new Map<number, ReaderBaseChapterContent>();
  const decoratedArtifactByChapter = new Map<
    number,
    ReaderDecoratedChapterArtifact
  >();
  const artifactsByChapter = createEmptyArtifactList(chapterEntries.length);

  for (const chapterIndex of buildReaderChapterLoadOrder(
    chapterEntries.length,
    initialChapterIndex,
  )) {
    const chapter = chapterEntries[chapterIndex]!;
    const chapterContent = bodyCacheData.chapterContentsByPath.get(
      chapter.href,
    );
    if (!chapterContent) {
      throw new Error(
        `Missing cached chapter content for href "${chapter.href}" (chapter ${chapter.index})`,
      );
    }

    const baseContent = loadBaseChapterContent({
      chapterIndex,
      chapterContent,
      chapter,
    });
    const artifact = decorateChapterContent({
      baseContent,
      highlightsBySpineItemId,
    });

    baseContentByChapter.set(chapterIndex, baseContent);
    decoratedArtifactByChapter.set(chapterIndex, artifact);
    artifactsByChapter[chapterIndex] = artifact;
  }

  return {
    baseContentByChapter,
    decoratedArtifactByChapter,
    artifactsByChapter,
  };
}
