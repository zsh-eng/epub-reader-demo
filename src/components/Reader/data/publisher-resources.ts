import {
  isExternalHref,
  resolvePath,
} from "@/lib/epub-resource-utils";
import { parseFontFaceRules } from "@/lib/pagination-v2/shared/font-face-parser";
import { getPublisherFontFaceKey } from "@/lib/pagination-v2/shared/publisher-fonts";
import type {
  PublisherFontFace,
  PublisherStylesheet,
} from "@/lib/pagination-v2";
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

export async function loadPublisherStylesheets(options: {
  chapterDoc: Document;
  chapter: ChapterEntry;
  publisherResourceLoader: PublisherResourceLoader;
}): Promise<PublisherStylesheet[]> {
  const { chapterDoc, chapter, publisherResourceLoader } = options;
  const stylesheets: PublisherStylesheet[] = [];

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
    const stylesheet = await publisherResourceLoader.loadStylesheet(cssPath);
    if (!stylesheet) continue;
    stylesheets.push(stylesheet);
  }

  return stylesheets;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return `data:${blob.type || "application/octet-stream"};base64,${btoa(
    binary,
  )}`;
}

async function inlineFontUrls(options: {
  cssText: string;
  basePath: string;
  loadResource: (path: string) => Promise<Blob | null>;
  loadFontDataUrl?: (path: string) => Promise<string | null>;
}): Promise<string> {
  const { cssText, basePath, loadResource, loadFontDataUrl } = options;
  const urlPattern = /url\(([^)]+)\)/gi;
  const replacements = new Map<string, string>();

  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(cssText)) !== null) {
    const rawToken = match[1];
    if (!rawToken) continue;

    const unquoted = rawToken.trim().replace(/^['"]|['"]$/g, "");
    if (
      !unquoted ||
      isExternalHref(unquoted) ||
      unquoted.startsWith("data:")
    ) {
      continue;
    }

    const fontPath = resolvePath(basePath, unquoted);
    const fontDataUrl = loadFontDataUrl
      ? await loadFontDataUrl(fontPath)
      : null;
    if (fontDataUrl) {
      replacements.set(match[0], `url("${fontDataUrl}")`);
      continue;
    }

    const fontBlob = await loadResource(fontPath);
    if (!fontBlob) continue;
    replacements.set(match[0], `url("${await blobToDataUrl(fontBlob)}")`);
  }

  if (replacements.size === 0) return cssText;

  let inlined = cssText;
  for (const [original, replacement] of replacements) {
    inlined = inlined.split(original).join(replacement);
  }
  return inlined;
}

export function dedupePublisherFontFaces(
  fontFaces: PublisherFontFace[],
): PublisherFontFace[] {
  const seen = new Set<string>();
  const deduped: PublisherFontFace[] = [];

  for (const face of fontFaces) {
    const key = getPublisherFontFaceKey(face);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(face);
  }

  return deduped;
}

async function loadPublisherFontFaces(options: {
  stylesheets: PublisherStylesheet[];
  loadResource: (path: string) => Promise<Blob | null>;
  loadFontDataUrl?: (path: string) => Promise<string | null>;
}): Promise<PublisherFontFace[]> {
  const { stylesheets, loadResource, loadFontDataUrl } = options;
  const fontFaces: PublisherFontFace[] = [];

  for (const stylesheet of stylesheets) {
    const fontFaceCssText =
      stylesheet.cssText.match(/@font-face\s*{[^}]*}/gi)?.join("\n") ?? "";
    if (!fontFaceCssText) continue;

    const inlinedCssText = await inlineFontUrls({
      cssText: fontFaceCssText,
      basePath: stylesheet.basePath,
      loadResource,
      loadFontDataUrl,
    });
    fontFaces.push(
      ...parseFontFaceRules(inlinedCssText, "https://epub.local/"),
    );
  }

  return dedupePublisherFontFaces(fontFaces);
}

export interface PublisherResourceLoader {
  loadStylesheet: (path: string) => Promise<PublisherStylesheet | null>;
  loadFontFaces: (
    stylesheets: PublisherStylesheet[],
  ) => Promise<PublisherFontFace[]>;
}

export function createPublisherResourceLoader(
  loadResource: (path: string) => Promise<Blob | null>,
): PublisherResourceLoader {
  const stylesheetsByPath = new Map<
    string,
    Promise<PublisherStylesheet | null>
  >();
  const fontDataUrlsByPath = new Map<string, Promise<string | null>>();
  const fontFacesByStylesheetKey = new Map<
    string,
    Promise<PublisherFontFace[]>
  >();

  async function loadFontDataUrl(path: string): Promise<string | null> {
    let promise = fontDataUrlsByPath.get(path);
    if (!promise) {
      promise = (async () => {
        const blob = await loadResource(path);
        return blob ? blobToDataUrl(blob) : null;
      })();
      fontDataUrlsByPath.set(path, promise);
    }
    return promise;
  }

  function loadStylesheet(path: string): Promise<PublisherStylesheet | null> {
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

  async function loadFontFaces(
    stylesheets: PublisherStylesheet[],
  ): Promise<PublisherFontFace[]> {
    const fontFaceLists = await Promise.all(
      stylesheets.map((stylesheet) => {
        const key =
          stylesheet.resourcePath ??
          `inline:${stylesheet.basePath}:${stylesheet.cssText}`;
        let promise = fontFacesByStylesheetKey.get(key);
        if (!promise) {
          promise = loadPublisherFontFaces({
            stylesheets: [stylesheet],
            loadResource,
            loadFontDataUrl,
          });
          fontFacesByStylesheetKey.set(key, promise);
        }
        return promise;
      }),
    );
    return dedupePublisherFontFaces(fontFaceLists.flat());
  }

  return { loadStylesheet, loadFontFaces };
}
