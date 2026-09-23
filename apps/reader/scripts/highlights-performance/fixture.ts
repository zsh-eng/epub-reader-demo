import { db, type Book } from "@/lib/db";
import { parseFileId } from "@/lib/files/file-id";
import type { SyncV2Book, SyncV2Highlight } from "@/lib/sync-v2/db";
import type { AnnotationColor } from "@/lib/highlight-constants";
import type { Highlight } from "@/types/highlight";

const HIGHLIGHT_COUNT = 900;
const MULTI_BOOK_COUNT = 20;
const CHAPTER_COUNT = 24;
const FIXTURE_NOW = Date.UTC(2026, 7, 30, 0, 0, 0);
const FIXTURE_COLORS: AnnotationColor[] = [
  "yellow",
  "green",
  "blue",
  "magenta",
];
const FIXTURE_SENTENCES = [
  "A stable interface lets the reader focus on the text instead of the machinery around it.",
  "The shape of a page becomes easier to understand when every card has a clear visual purpose.",
  "Performance is part of the reading experience because delay changes how direct an action feels.",
  "Good tools keep their structure predictable while leaving enough variation to remain engaging.",
];

function createFixtureBook(bookIndex: number): Book {
  const manifest = Array.from({ length: CHAPTER_COUNT }, (_, chapterIndex) => ({
    id: `chapter-${chapterIndex}`,
    href: `chapters/chapter-${chapterIndex + 1}.xhtml`,
    mediaType: "application/xhtml+xml",
  }));

  return {
    id: `highlights-performance-book-${bookIndex}`,
    sourceFileId: parseFileId(
      `xxh64:${bookIndex.toString(16).padStart(16, "0")}`,
    ),
    title: `Performance Test Book ${bookIndex + 1}`,
    author: `Fixture Author ${bookIndex + 1}`,
    fileSize: 1_000_000,
    dateAdded: FIXTURE_NOW - bookIndex,
    metadata: { fixture: "highlights-performance" },
    manifest,
    spine: manifest.map(({ id }) => ({ idref: id })),
    toc: manifest.map(({ href }, chapterIndex) => ({
      label: `Chapter ${chapterIndex + 1}`,
      href,
    })),
    cover: null,
  };
}

function createSelectedText(highlightIndex: number): string {
  if (highlightIndex % 19 === 0) {
    return `${["Attention", "Memory", "Pattern"][highlightIndex % 3]!} ${getUniqueWord(highlightIndex)}`;
  }

  const sentenceCount = 1 + (highlightIndex % 4);
  const body = Array.from(
    { length: sentenceCount },
    (_, sentenceIndex) =>
      FIXTURE_SENTENCES[
        (highlightIndex + sentenceIndex) % FIXTURE_SENTENCES.length
      ]!,
  ).join(" ");

  return `${body} Diagnostic marker ${getUniqueWord(highlightIndex)} keeps this highlight text unique.`;
}

function getUniqueWord(value: number): string {
  let remaining = value;
  let result = "";

  do {
    result = String.fromCharCode(97 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);

  return `fixture${result}`;
}

function createFixtureHighlight(highlightIndex: number, book: Book): Highlight {
  const chapterIndex = highlightIndex % CHAPTER_COUNT;
  const selectedText = createSelectedText(highlightIndex);
  const createdAt = FIXTURE_NOW - highlightIndex * 60_000;

  return {
    id: `highlights-performance-highlight-${highlightIndex}`,
    bookId: book.id,
    spineItemId: `chapter-${chapterIndex}`,
    startOffset: highlightIndex * 100,
    endOffset: highlightIndex * 100 + selectedText.length,
    selectedText,
    textBefore: "Synthetic context before the selected text.",
    textAfter: "Synthetic context after the selected text.",
    color: FIXTURE_COLORS[highlightIndex % FIXTURE_COLORS.length]!,
    createdAt,
    updatedAt: createdAt,
  };
}

function createFixtureGroups(bookCount: number) {
  const highlightsPerBook = HIGHLIGHT_COUNT / bookCount;

  return Array.from({ length: bookCount }, (_, bookIndex) => {
    const book = createFixtureBook(bookIndex);
    const firstHighlightIndex = bookIndex * highlightsPerBook;
    const highlights = Array.from({ length: highlightsPerBook }, (_, offset) =>
      createFixtureHighlight(firstHighlightIndex + offset, book),
    );

    return {
      book,
      highlights,
      mostRecentHighlight: highlights[0]!.createdAt,
    };
  });
}

/** Seeds the benchmark origin's isolated IndexedDB with deterministic data. */
export async function seedHighlightsPerformanceFixture() {
  const distribution = new URLSearchParams(window.location.search).get(
    "distribution",
  );
  const groups = createFixtureGroups(
    distribution === "single" ? 1 : MULTI_BOOK_COUNT,
  );

  await db.transaction("rw", [db.books, db.highlights], async () => {
    await db.books.bulkPut(
      groups.map(({ book }) => ({ ...book, isDeleted: false }) as SyncV2Book),
    );
    await db.highlights.bulkPut(
      groups.flatMap(({ highlights }) =>
        highlights.map(
          (highlight) =>
            ({ ...highlight, isDeleted: false }) as SyncV2Highlight,
        ),
      ),
    );
  });

  return groups;
}
