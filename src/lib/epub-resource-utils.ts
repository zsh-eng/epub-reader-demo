/**
 * Utility functions for handling EPUB resources and path resolution
 */

import { EPUB_LINK } from "@/types/reader.types";

export const DEFERRED_EPUB_IMAGE_PREFIX = "epub-deferred://";

export function createDeferredEpubImageSrc(resourcePath: string): string {
  return `${DEFERRED_EPUB_IMAGE_PREFIX}${resourcePath}`;
}

export function getDeferredEpubImagePath(src: string): string | null {
  if (!src.startsWith(DEFERRED_EPUB_IMAGE_PREFIX)) {
    return null;
  }

  const resourcePath = src.slice(DEFERRED_EPUB_IMAGE_PREFIX.length);
  return resourcePath.length > 0 ? resourcePath : null;
}

/**
 * Returns the MIME type for parsing EPUB content.
 * XHTML content must be parsed as XML to correctly handle self-closing tags.
 * @returns The MIME type to use with DOMParser
 */
export function getMimeTypeForContent(
  mediaType: string,
  content: string,
): DOMParserSupportedType {
  const normalizedType = mediaType.toLowerCase();

  if (
    normalizedType.includes("xhtml") ||
    normalizedType.includes("xml") ||
    content.trimStart().startsWith("<?xml")
  ) {
    return "application/xhtml+xml";
  }

  return "text/html";
}

/**
 * Remove active content from EPUB chapters. EPUB JavaScript should never run.
 */
function sanitizeDocument(doc: Document): void {
  // Remove active elements entirely
  doc.querySelectorAll("script, iframe, object, embed").forEach((el) => {
    el.remove();
  });

  // Remove inline handlers and dangerous URL schemes from all elements
  const allElements = doc.querySelectorAll("*");
  for (const element of Array.from(allElements)) {
    for (const { name } of Array.from(element.attributes)) {
      if (name.toLowerCase().startsWith("on")) {
        element.removeAttribute(name);
      }
    }

    const href = element.getAttribute("href");
    if (href && /^\s*(javascript|vbscript):/i.test(href)) {
      element.removeAttribute("href");
    }

    const src = element.getAttribute("src");
    if (src && /^\s*(javascript|vbscript):/i.test(src)) {
      element.removeAttribute("src");
    }

    const xlinkHref =
      element.getAttribute("xlink:href") ||
      element.getAttributeNS("http://www.w3.org/1999/xlink", "href");

    if (xlinkHref && /^\s*(javascript|vbscript):/i.test(xlinkHref)) {
      element.removeAttribute("xlink:href");
      element.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
    }
  }
}

/**
 * Resolves a relative path against a base path
 * @param basePath - The base path (e.g., current chapter's path)
 * @param relativePath - The relative path to resolve
 * @returns The resolved absolute path
 */
export function resolvePath(basePath: string, relativePath: string): string {
  // Remove any query strings or fragments
  const cleanPath = relativePath.split(/[#?]/)[0];

  // If it's already absolute or a data URL, return as-is
  if (
    cleanPath.startsWith("http") ||
    cleanPath.startsWith("data:") ||
    cleanPath.startsWith("blob:")
  ) {
    return relativePath;
  }

  // Get the directory of the base path
  const baseDir = basePath.substring(0, basePath.lastIndexOf("/") + 1);

  // Handle relative path navigation
  const parts = (baseDir + cleanPath).split("/");
  const resolvedParts: string[] = [];

  for (const part of parts) {
    if (part === "..") {
      resolvedParts.pop();
    } else if (part !== "." && part !== "") {
      resolvedParts.push(part);
    }
  }

  return resolvedParts.join("/");
}

/**
 * Options for processing embedded resources in EPUB content
 */
export interface ProcessResourcesOptions {
  /** The HTML/XHTML content to process */
  content: string;
  /** The media type of the content (e.g., "application/xhtml+xml") */
  mediaType: string;
  /** The base path for resolving relative resource paths */
  basePath: string;
  /** Function to load a resource by path, should return a Blob or null */
  loadResource: (path: string) => Promise<Blob | null>;
  /** Optional map to store created object URLs for cleanup */
  resourceUrlMap?: Map<string, string>;
  /** Skip loading <img> resources and mark them for deferred loading */
  skipImages?: boolean;
}

/**
 * Result of processing embedded resources
 */
export interface ProcessResourcesResult {
  /** The DOM Document with resource URLs replaced */
  document: Document;
  /** Map of resource paths to their object URLs */
  resourceUrls: Map<string, string>;
  /** The MIME type used for parsing */
  mimeType: DOMParserSupportedType;
}

/**
 * Processes embedded resources in EPUB content (images, stylesheets, fonts, etc.)
 * Finds all resource references, loads them, creates object URLs, and replaces the references
 *
 * NOTE: We return the `Document` instead of just the HTML such that when we apply highlights,
 * we don't have to deserialise the HTML again. Serialising -> deserialising again causes inconsistencies
 * in the whitespace.
 *
 * @param options - Configuration for processing resources
 * @returns The processed HTML and a map of resource URLs
 */
export async function processEmbeddedResources(
  options: ProcessResourcesOptions,
): Promise<ProcessResourcesResult> {
  const {
    content,
    mediaType,
    basePath,
    loadResource,
    resourceUrlMap,
    skipImages = false,
  } = options;

  // Use provided map or create a new one
  const resourceUrls = resourceUrlMap || new Map<string, string>();

  // Parse the HTML/XHTML to find all resource references
  const parser = new DOMParser();
  const mimeType = getMimeTypeForContent(mediaType, content);
  const doc = parser.parseFromString(content, mimeType);
  sanitizeDocument(doc);

  // Find all elements with src, href, or xlink:href attributes
  const resourceElements = doc.querySelectorAll("[src], [href], [*|href]");

  // Process each resource
  for (const element of Array.from(resourceElements)) {
    const src = element.getAttribute("src");
    const href = element.getAttribute("href");
    // Handle both xlink:href and regular namespaced href
    const xlinkHref =
      element.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
      element.getAttribute("xlink:href");

    const resourcePath = src || xlinkHref || href;

    if (!resourcePath) continue;

    // Handle anchor elements specially
    if (element.tagName.toLowerCase() === "a" && href) {
      // Pure same-page anchor links (e.g., #footnote1) - leave them as-is
      if (href.startsWith("#")) {
        continue;
      }

      // Skip external links
      if (
        href.startsWith("http") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
      ) {
        continue;
      }

      // This is an internal EPUB link - mark it with data attributes
      const [pathPart, fragment] = href.split("#");
      const resolvedHref = pathPart ? resolvePath(basePath, pathPart) : "";

      element.setAttribute(EPUB_LINK.linkAttribute, "true");
      element.setAttribute(EPUB_LINK.hrefAttribute, resolvedHref);
      if (fragment) {
        element.setAttribute(EPUB_LINK.fragmentAttribute, fragment);
      }
      // Prevent native navigation; handled by ReaderContent click handler.
      element.setAttribute("href", "#");
      continue;
    }

    if (
      resourcePath.startsWith("http") ||
      resourcePath.startsWith("data:") ||
      resourcePath.startsWith("blob:")
    ) {
      continue;
    }

    // Resolve the resource path relative to the base path
    const resolvedPath = resolvePath(basePath, resourcePath);

    if (skipImages && src && element.tagName.toLowerCase() === "img") {
      element.setAttribute("src", createDeferredEpubImageSrc(resolvedPath));
      continue;
    }

    // Check if we already have a URL for this resource
    if (!resourceUrls.has(resolvedPath)) {
      // Try to load the resource
      const resourceBlob = await loadResource(resolvedPath);

      if (resourceBlob) {
        // Create an object URL for the resource
        const objectUrl = URL.createObjectURL(resourceBlob);
        resourceUrls.set(resolvedPath, objectUrl);
      } else {
        console.warn("Resource not found:", resolvedPath);
      }
    }

    // Replace the attribute with the object URL
    const objectUrl = resourceUrls.get(resolvedPath);
    if (objectUrl) {
      if (src) {
        element.setAttribute("src", objectUrl);
      } else if (xlinkHref) {
        // Set both namespaced and non-namespaced for compatibility
        element.setAttributeNS(
          "http://www.w3.org/1999/xlink",
          "xlink:href",
          objectUrl,
        );
        element.setAttribute("xlink:href", objectUrl);
      } else if (
        href &&
        (element.tagName.toLowerCase() === "link" ||
          element.tagName.toLowerCase() === "image")
      ) {
        element.setAttribute("href", objectUrl);
      }
    }
  }

  // Return the DOM document directly to avoid serialization/parsing issues
  return {
    document: doc,
    resourceUrls,
    mimeType,
  };
}

/**
 * Cleans up object URLs created for EPUB resources
 * Should be called when resources are no longer needed to prevent memory leaks
 *
 * @param resourceUrls - Map of resource URLs to revoke
 */
export function cleanupResourceUrls(resourceUrls: Map<string, string>): void {
  resourceUrls.forEach((url) => URL.revokeObjectURL(url));
  resourceUrls.clear();
}
