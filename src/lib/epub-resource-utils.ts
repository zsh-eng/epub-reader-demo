/**
 * Utility functions for handling EPUB resources and path resolution
 */

/**
 * Returns the MIME type for parsing EPUB content
 * Always returns "text/html" to ensure consistent whitespace handling
 * across the entire content processing pipeline, regardless of whether
 * the source was XHTML or HTML.
 * @returns The MIME type to use with DOMParser
 */
export function getMimeTypeForContent(): DOMParserSupportedType {
  return "text/html";
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
  const { content, basePath, loadResource, resourceUrlMap } = options;
  // Note: mediaType is kept in the interface for compatibility but not used here
  // We always parse as "text/html" for consistent whitespace handling

  // Use provided map or create a new one
  const resourceUrls = resourceUrlMap || new Map<string, string>();

  // Parse the HTML/XHTML to find all resource references
  // Always use text/html for consistent whitespace handling
  const parser = new DOMParser();
  const mimeType = getMimeTypeForContent();
  const doc = parser.parseFromString(content, mimeType);

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

    // Skip certain hrefs (like anchors and external links)
    if (element.tagName.toLowerCase() === "a" && href && href.startsWith("#")) {
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
