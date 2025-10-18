import { type Book, type TOCItem } from "@/lib/db";

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

/**
 * Gets the chapter title from the TOC based on the current spine index.
 * Returns an empty string if the chapter title cannot be found.
 */
export function getChapterTitleFromSpine(
  book: Book,
  spineIndex: number,
): string {
  const spineItem = book.spine[spineIndex];
  if (!spineItem) return "";

  // Find the manifest item to get the href
  const manifestItem = book.manifest.find(
    (item) => item.id === spineItem.idref,
  );
  if (!manifestItem) return "";

  // Find the corresponding TOC item
  const tocItem = findTOCItemByHref(book.toc, manifestItem.href);
  if (!tocItem) {
    return "";
  }

  return tocItem.label;
}

/**
 * Finds the spine index for a given href.
 * Returns null if the href cannot be found in the book's manifest or spine.
 */
export function findSpineIndexByHref(book: Book, href: string): number | null {
  // Find the manifest item for this href
  const manifestItem = book.manifest.find(
    (item) => item.href === href || item.href.endsWith(href),
  );
  if (!manifestItem) {
    console.error("Manifest item not found for href:", href);
    return null;
  }

  // Find the spine index
  const spineIndex = book.spine.findIndex(
    (item) => item.idref === manifestItem.id,
  );

  return spineIndex !== -1 ? spineIndex : null;
}
