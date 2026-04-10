import { type Book, type TOCItem } from "@/lib/db";
import { splitHrefFragment } from "@/lib/epub-resource-utils";

/**
 * Recursively searches through TOC items to find an item matching the target href.
 * Compares both full paths and filenames to handle different href formats.
 */
export function findTOCItemByHref(
  items: TOCItem[],
  targetHref: string,
): TOCItem | null {
  for (const item of items) {
    // Check if this item matches (compare both full path and just filename)
    if (
      item.href === targetHref ||
      item.href.endsWith(targetHref) ||
      targetHref.endsWith(item.href)
    ) {
      return item;
    }
    // Recursively search children
    if (item.children && item.children.length > 0) {
      const found = findTOCItemByHref(item.children, targetHref);
      if (found) return found;
    }
  }
  return null;
}

function chapterNumberFallback(spineIndex: number): string {
  return `Chapter ${Math.max(1, spineIndex + 1)}`;
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function toTitleCaseToken(token: string): string {
  if (token.length === 0) return token;
  if (/^[A-Z0-9]+$/.test(token)) return token;
  return token[0].toUpperCase() + token.slice(1);
}

function getChapterTitleFromHref(href: string): string {
  const pathWithoutFragment = href.split("#")[0] ?? href;
  const decodedPath = decodePath(pathWithoutFragment);
  const fileName = decodedPath.split("/").pop() ?? decodedPath;
  const withoutExtension = fileName.replace(/\.[^/.]+$/, "");

  const normalized = withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/([a-z]{2,})(\d+)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "";

  return normalized
    .split(" ")
    .map((token) => toTitleCaseToken(token))
    .join(" ");
}

/**
 * Gets the chapter title from the TOC based on the current spine index.
 * Falls back to a filename-derived title when the TOC has no matching entry.
 */
export function getChapterTitleFromSpine(
  book: Book,
  spineIndex: number,
): string {
  const spineItem = book.spine[spineIndex];
  if (!spineItem) return chapterNumberFallback(spineIndex);

  // Find the manifest item to get the href
  const manifestItem = book.manifest.find(
    (item) => item.id === spineItem.idref,
  );
  if (!manifestItem) return chapterNumberFallback(spineIndex);

  // Find the corresponding TOC item
  const tocItem = findTOCItemByHref(book.toc, manifestItem.href);
  if (tocItem?.label) {
    return tocItem.label;
  }

  const hrefFallback = getChapterTitleFromHref(manifestItem.href);
  if (hrefFallback) {
    return hrefFallback;
  }

  return chapterNumberFallback(spineIndex);
}

/**
 * Finds the spine index for a given href.
 * Returns null if the href cannot be found in the book's manifest or spine.
 */
export function findSpineIndexByHref(book: Book, href: string): number | null {
  const { path } = splitHrefFragment(href);

  // Find the manifest item for this href
  const manifestItem = book.manifest.find(
    (item) => item.href === path || item.href.endsWith(path),
  );
  if (!manifestItem) {
    console.error("Manifest item not found for href:", path);
    return null;
  }

  // Find the spine index
  const spineIndex = book.spine.findIndex(
    (item) => item.idref === manifestItem.id,
  );

  return spineIndex !== -1 ? spineIndex : null;
}
