import { processEmbeddedResources } from "@/lib/epub-resource-utils";
import type {
  Book,
  BookFile,
  SyncedReadingCheckpoint,
} from "@/lib/db";
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
      console.warn("[ReaderV2] Missing spine item while building chapter entries", {
        bookId: book.id,
        spineIndex: index,
      });
      continue;
    }

    const manifestItem = book.manifest.find((item) => item.id === spineItem.idref);
    if (!manifestItem?.href) {
      console.warn(
        "[ReaderV2] Missing manifest href for spine item while building chapter entries",
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

async function extractBodyHtml(
  chapterFile: BookFile,
  chapter: ChapterEntry,
  imageDimensionsByPath: Map<string, { width: number; height: number }>,
): Promise<string> {
  const text = await chapterFile.content.text();
  const { document: chapterDoc } = await processEmbeddedResources({
    content: text,
    mediaType: chapterFile.mediaType,
    basePath: chapter.href,
    loadResource: async () => null,
    skipImages: true,
    loadLinkedResources: false,
    imageDimensionsByPath,
  });

  return chapterDoc.querySelector("body")?.innerHTML ?? "";
}

export async function loadBaseChapterContent(options: {
  chapterIndex: number;
  chapterFile: BookFile;
  chapter: ChapterEntry;
  imageDimensionsByPath: Map<string, { width: number; height: number }>;
}): Promise<ReaderBaseChapterContent> {
  const { chapterIndex, chapterFile, chapter, imageDimensionsByPath } = options;
  const html = await extractBodyHtml(chapterFile, chapter, imageDimensionsByPath);
  const { canonicalText } = parseChapterHtmlWithCanonicalText(html);

  return {
    chapterIndex,
    entry: chapter,
    html,
    canonicalText,
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
    previousArtifact.source.highlightedHtml !== nextArtifact.source.highlightedHtml
  );
}
