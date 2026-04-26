import { processEmbeddedResources } from "@/lib/epub-resource-utils";
import type { Book, SyncedReadingCheckpoint } from "@/lib/db";
import {
  parseChapterHtml,
  parseChapterHtmlWithCanonicalText,
  type ChapterCanonicalText,
} from "@/lib/pagination-v2";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import type { Highlight } from "@/types/highlight";
import {
  applyChapterHighlights,
  buildHighlightSignature,
  type VirtualChapterSource,
} from "../highlight-virtualization";
import type { ChapterEntry } from "../types";

export type ParsedChapterBlocks = ReturnType<typeof parseChapterHtml>;

export interface ReaderBaseChapterContent {
  chapterIndex: number;
  entry: ChapterEntry;
  html: string;
  canonicalText: ChapterCanonicalText;
}

export interface ReaderChapterCachedContent {
  bodyHtml: string;
  canonicalText: ChapterCanonicalText;
}

export interface ReaderDecoratedChapterArtifact {
  chapterIndex: number;
  entry: ChapterEntry;
  source: VirtualChapterSource;
  blocks: ParsedChapterBlocks;
  highlightSignature: string;
}

export interface ReaderInitialLocation {
  chapterIndex: number;
  chapterProgress?: number;
  isRestore: boolean;
}

export function buildChapterEntries(book: Book | null): ChapterEntry[] {
  if (!book) return [];

  const chapterEntries: ChapterEntry[] = [];

  for (let index = 0; index < book.spine.length; index++) {
    const spineItem = book.spine[index];
    if (!spineItem) {
      console.warn(
        "[Reader] Missing spine item while building chapter entries",
        {
          bookId: book.id,
          spineIndex: index,
        },
      );
      continue;
    }

    const manifestItem = book.manifest.find(
      (item) => item.id === spineItem.idref,
    );
    if (!manifestItem?.href) {
      console.warn(
        "[Reader] Missing manifest href for spine item while building chapter entries",
        {
          bookId: book.id,
          spineIndex: index,
          spineItemId: spineItem.idref,
        },
      );
      continue;
    }

    chapterEntries.push({
      index,
      spineItemId: spineItem.idref,
      href: manifestItem.href,
      title: getChapterTitleFromSpine(book, index) || `Chapter ${index + 1}`,
    });
  }

  return chapterEntries;
}

export function resolveInitialReaderLocation(
  checkpoint: SyncedReadingCheckpoint | undefined,
  totalChapters: number,
): ReaderInitialLocation {
  const chapterIndex = Math.max(
    0,
    Math.min(checkpoint?.currentSpineIndex ?? 0, totalChapters - 1),
  );

  return {
    chapterIndex,
    chapterProgress: checkpoint?.scrollProgress,
    isRestore: checkpoint !== undefined,
  };
}

export function buildReaderChapterLoadOrder(
  totalChapters: number,
  initialChapterIndex: number,
): number[] {
  if (totalChapters <= 0) return [];

  const center = Math.max(
    0,
    Math.min(Math.floor(initialChapterIndex), totalChapters - 1),
  );
  const order = [center];

  for (let delta = 1; order.length < totalChapters; delta++) {
    const nextChapterIndex = center + delta;
    if (nextChapterIndex < totalChapters) order.push(nextChapterIndex);

    const previousChapterIndex = center - delta;
    if (previousChapterIndex >= 0) order.push(previousChapterIndex);
  }

  return order;
}

export async function buildReaderChapterCachedContent(options: {
  source: string;
  mediaType: string;
  chapter: ChapterEntry;
}): Promise<ReaderChapterCachedContent> {
  const { source, mediaType, chapter } = options;
  const { document: chapterDoc } = await processEmbeddedResources({
    content: source,
    mediaType,
    basePath: chapter.href,
    loadResource: async () => null,
    skipImages: true,
    loadLinkedResources: false,
  });
  const bodyHtml = chapterDoc.querySelector("body")?.innerHTML ?? "";
  const { canonicalText } = parseChapterHtmlWithCanonicalText(bodyHtml);

  return {
    bodyHtml,
    canonicalText,
  };
}

export function loadBaseChapterContent(options: {
  chapterIndex: number;
  chapterContent: ReaderChapterCachedContent;
  chapter: ChapterEntry;
}): ReaderBaseChapterContent {
  const { chapterIndex, chapterContent, chapter } = options;

  return {
    chapterIndex,
    entry: chapter,
    html: chapterContent.bodyHtml,
    canonicalText: chapterContent.canonicalText,
  };
}

export function decorateChapterContent(options: {
  baseContent: ReaderBaseChapterContent;
  highlightsBySpineItemId: ReadonlyMap<string, Highlight[]>;
}): ReaderDecoratedChapterArtifact {
  const { baseContent, highlightsBySpineItemId } = options;
  const chapterHighlights =
    highlightsBySpineItemId.get(baseContent.entry.spineItemId) ?? [];
  const source = applyChapterHighlights(
    { html: baseContent.html, highlightedHtml: baseContent.html },
    chapterHighlights,
  );

  return {
    chapterIndex: baseContent.chapterIndex,
    entry: baseContent.entry,
    source,
    blocks: parseChapterHtml(source.highlightedHtml),
    highlightSignature: buildHighlightSignature(chapterHighlights),
  };
}

export function didDecoratedChapterBlocksChange(
  previousArtifact: ReaderDecoratedChapterArtifact,
  nextArtifact: ReaderDecoratedChapterArtifact,
): boolean {
  return (
    previousArtifact.source.highlightedHtml !==
    nextArtifact.source.highlightedHtml
  );
}
