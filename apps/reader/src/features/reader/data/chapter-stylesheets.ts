import { isExternalHref, resolvePath } from "@/lib/epub-resource-utils";
import type { BookStylesheet } from "@/lib/pagination-v2";
import type { ChapterEntry } from "../types";

function getStylesheetLinks(chapterDoc: Document): HTMLLinkElement[] {
  return Array.from(
    chapterDoc.querySelectorAll<HTMLLinkElement>("link[href]"),
  ).filter((link) =>
    (link.getAttribute("rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .includes("stylesheet"),
  );
}

export interface ChapterStylesheetLoader {
  loadStylesheet: (path: string) => Promise<BookStylesheet | null>;
}

export function createChapterStylesheetLoader(
  loadResource: (path: string) => Promise<Blob | null>,
): ChapterStylesheetLoader {
  const stylesheetsByPath = new Map<string, Promise<BookStylesheet | null>>();

  function loadStylesheet(path: string): Promise<BookStylesheet | null> {
    let promise = stylesheetsByPath.get(path);
    if (!promise) {
      promise = (async () => {
        const stylesheet = await loadResource(path);
        if (!stylesheet) return null;
        return {
          cssText: await stylesheet.text(),
          basePath: path,
          resourcePath: path,
        };
      })();
      stylesheetsByPath.set(path, promise);
    }
    return promise;
  }

  return { loadStylesheet };
}

/**
 * Loads the chapter's linked and embedded CSS for structural page-break hints.
 * This remains independent from Publisher Book Styling and does not load font
 * binaries.
 */
export async function loadChapterStylesheets(options: {
  chapterDoc: Document;
  chapter: ChapterEntry;
  stylesheetLoader: ChapterStylesheetLoader;
}): Promise<BookStylesheet[]> {
  const { chapterDoc, chapter, stylesheetLoader } = options;
  const stylesheets: BookStylesheet[] = [];

  for (const styleElement of Array.from(
    chapterDoc.querySelectorAll("style"),
  )) {
    const cssText = styleElement.textContent?.trim();
    if (!cssText) continue;
    stylesheets.push({ cssText, basePath: chapter.href });
  }

  for (const link of getStylesheetLinks(chapterDoc)) {
    const href = link.getAttribute("href")?.trim();
    if (!href || isExternalHref(href)) continue;

    const cssPath = resolvePath(chapter.href, href);
    const stylesheet = await stylesheetLoader.loadStylesheet(cssPath);
    if (!stylesheet) continue;
    stylesheets.push(stylesheet);
  }

  return stylesheets;
}
