/**
 * Reader-facing chapter metadata derived from the EPUB spine.
 *
 * This is similar to a coarse table of contents entry, but it is guaranteed to
 * align 1:1 with the chapter sources we load and feed into pagination.
 */
export interface ChapterEntry {
  index: number;
  spineItemId: string;
  href: string;
  title: string;
}
