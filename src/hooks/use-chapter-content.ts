import { getBookFile, type Book } from "@/lib/db";
import {
  cleanupResourceUrls,
  processEmbeddedResources,
} from "@/lib/epub-resource-utils";
import { applyHighlightsToDocument } from "@/lib/highlight-utils";
import type { Highlight } from "@/types/highlight";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export interface UseChapterContentReturn {
  chapterContent: string;
  resourceUrlsRef: RefObject<Map<string, string>>;
}

export function useChapterContent(
  book: Book | null,
  bookId: string | undefined,
  currentChapterIndex: number,
  initialHighlights: Highlight[] = [],
): UseChapterContentReturn {
  const [chapterContent, setChapterContent] = useState<string>("");
  const resourceUrlsRef = useRef<Map<string, string>>(new Map());

  const loadChapterContent = useCallback(async () => {
    if (!book || !bookId) return;

    try {
      const spineItem = book.spine[currentChapterIndex];
      if (!spineItem) {
        console.error("Spine item not found for index:", currentChapterIndex);
        return;
      }

      // Find the manifest item
      const manifestItem = book.manifest.find(
        (item) => item.id === spineItem.idref,
      );
      if (!manifestItem) {
        console.error("Manifest item not found for idref:", spineItem.idref);
        return;
      }

      // Load the file content
      const bookFile = await getBookFile(bookId, manifestItem.href);
      if (!bookFile) {
        console.error("Book file not found:", manifestItem.href);
        setChapterContent("<p>Chapter content not found.</p>");
        return;
      }

      // Clean up previous resource URLs
      cleanupResourceUrls(resourceUrlsRef.current);

      // Convert blob to text
      const text = await bookFile.content.text();

      // Process embedded resources (images, stylesheets, fonts, etc.)
      const { document: doc } = await processEmbeddedResources({
        content: text,
        mediaType: manifestItem.mediaType,
        basePath: manifestItem.href,
        loadResource: async (path: string) => {
          const resourceFile = await getBookFile(bookId, path);
          return resourceFile?.content || null;
        },
        resourceUrlMap: resourceUrlsRef.current,
      });

      // Apply initial highlights for the current chapter
      // Only initial highlights are applied here during chapter load
      // New highlights created by the user are applied directly to the live DOM
      const currentSpineItemId = spineItem.idref;
      const chapterHighlights = initialHighlights.filter(
        (h) => h.spineItemId === currentSpineItemId,
      );
      const htmlWithHighlights = applyHighlightsToDocument(
        doc,
        chapterHighlights,
      );

      setChapterContent(htmlWithHighlights);

      // Reset scroll position when chapter changes
      window.scrollTo({
        top: 0,
        behavior: "instant",
      });
    } catch (error) {
      console.error("Error loading chapter:", error);
      setChapterContent("<p>Error loading chapter content.</p>");
    }
  }, [book, bookId, currentChapterIndex, initialHighlights]);

  useEffect(() => {
    loadChapterContent();

    // Capture the current map reference for cleanup
    const urlsMap = resourceUrlsRef.current;

    // Cleanup function to revoke object URLs when component unmounts
    return () => {
      cleanupResourceUrls(urlsMap);
    };
  }, [loadChapterContent]);

  return {
    chapterContent,
    resourceUrlsRef,
  };
}
