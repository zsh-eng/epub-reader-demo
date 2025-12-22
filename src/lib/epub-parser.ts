import type {
  Book,
  BookFile,
  ManifestItem,
  SpineItem,
  TOCItem,
} from "@/lib/db";
import { unzip } from "fflate";

export interface ParsedEPUB {
  book: Book;
  files: BookFile[];
}

export interface ParsedEPUBMetadata {
  title: string;
  author: string;
  manifest: ManifestItem[];
  spine: SpineItem[];
  toc: TOCItem[];
  coverImagePath?: string;
  metadata: {
    publisher?: string;
    language?: string;
    isbn?: string;
    description?: string;
    publicationDate?: string;
  };
}

export interface ParseEPUBOptions {
  fileHash: string;
}

/**
 * Extract and parse an EPUB file
 */
export async function parseEPUB(
  file: File,
  options: ParseEPUBOptions,
): Promise<ParsedEPUB> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Unzip the EPUB file
  const unzipped = await unzipAsync(uint8Array);

  // Parse container.xml to find the OPF file
  const opfPath = await findOPFPath(unzipped);

  if (!opfPath) {
    throw new Error("Could not find OPF file in EPUB");
  }

  // Parse the OPF file
  const opfContent = new TextDecoder().decode(unzipped[opfPath]);
  const opfDoc = new DOMParser().parseFromString(opfContent, "text/xml");

  // Extract metadata
  const metadata = extractMetadata(opfDoc);

  // Extract manifest
  const manifest = extractManifest(opfDoc, opfPath);

  // Extract spine
  const spine = extractSpine(opfDoc);

  // Extract table of contents
  const toc = await extractTOC(opfDoc, manifest, unzipped, opfPath);

  // Extract cover image path
  const coverImagePath = extractCoverImagePath(opfDoc, manifest, unzipped);

  // Generate unique ID
  const bookId = generateId();

  // Create Book object
  const book: Book = {
    id: bookId,
    fileHash: options.fileHash,
    title: metadata.title || file.name.replace(".epub", ""),
    author: metadata.author || "Unknown Author",
    coverImagePath,
    dateAdded: new Date().getTime(),
    fileSize: file.size,
    manifest,
    spine,
    toc,
    metadata: {
      publisher: metadata.publisher,
      language: metadata.language,
      isbn: metadata.isbn,
      description: metadata.description,
      publicationDate: metadata.publicationDate,
    },
    isDownloaded: 1, // Local file is always downloaded
  };

  // Create BookFile objects for all content files
  const bookFiles: BookFile[] = [];
  let fileIdCounter = 0;

  for (const [path, content] of Object.entries(unzipped)) {
    // Store all files from the EPUB
    const mediaType = getMediaType(path, manifest);
    bookFiles.push({
      id: `${bookId}-file-${fileIdCounter++}`,
      bookId,
      path,
      content: new Blob([content.buffer as ArrayBuffer]),
      mediaType,
    });
  }

  return { book, files: bookFiles };
}

/**
 * Unzip the EPUB file asynchronously
 */
function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Find the path to the OPF file by parsing META-INF/container.xml
 */
async function findOPFPath(
  files: Record<string, Uint8Array>,
): Promise<string | null> {
  const containerPath = "META-INF/container.xml";
  const containerData = files[containerPath];

  if (!containerData) {
    return null;
  }

  const containerXml = new TextDecoder().decode(containerData);
  const containerDoc = new DOMParser().parseFromString(
    containerXml,
    "text/xml",
  );

  const rootfile = containerDoc.querySelector("rootfile");
  return rootfile?.getAttribute("full-path") || null;
}

/**
 * Extract metadata from OPF
 */
function extractMetadata(opfDoc: Document): {
  title?: string;
  author?: string;
  publisher?: string;
  language?: string;
  isbn?: string;
  description?: string;
  publicationDate?: string;
} {
  const metadata: Record<string, string | undefined> = {};

  // Title
  const titleEl = opfDoc.querySelector("metadata title, metadata dc\\:title");
  metadata.title = titleEl?.textContent?.trim();

  // Author/Creator
  const authorEl = opfDoc.querySelector(
    "metadata creator, metadata dc\\:creator",
  );
  metadata.author = authorEl?.textContent?.trim();

  // Publisher
  const publisherEl = opfDoc.querySelector(
    "metadata publisher, metadata dc\\:publisher",
  );
  metadata.publisher = publisherEl?.textContent?.trim();

  // Language
  const languageEl = opfDoc.querySelector(
    "metadata language, metadata dc\\:language",
  );
  metadata.language = languageEl?.textContent?.trim();

  // ISBN (identifier)
  const identifiers = opfDoc.querySelectorAll(
    "metadata identifier, metadata dc\\:identifier",
  );
  for (const id of Array.from(identifiers)) {
    const scheme = id.getAttribute("opf:scheme") || id.getAttribute("scheme");
    if (scheme?.toLowerCase() === "isbn") {
      metadata.isbn = id.textContent?.trim();
      break;
    }
  }

  // Description
  const descEl = opfDoc.querySelector(
    "metadata description, metadata dc\\:description",
  );
  metadata.description = descEl?.textContent?.trim();

  // Publication Date
  const dateEl = opfDoc.querySelector("metadata date, metadata dc\\:date");
  metadata.publicationDate = dateEl?.textContent?.trim();

  return metadata;
}

/**
 * Extract manifest from OPF
 */
function extractManifest(opfDoc: Document, opfPath: string): ManifestItem[] {
  const manifest: ManifestItem[] = [];
  const manifestItems = opfDoc.querySelectorAll("manifest item");

  for (const item of Array.from(manifestItems)) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type");
    const properties = item.getAttribute("properties");

    if (id && href && mediaType) {
      manifest.push({
        id,
        href: resolveHref(href, opfPath),
        mediaType,
        properties: properties || undefined,
      });
    }
  }

  return manifest;
}

/**
 * Extract spine from OPF
 */
function extractSpine(opfDoc: Document): SpineItem[] {
  const spine: SpineItem[] = [];
  const spineItems = opfDoc.querySelectorAll("spine itemref");

  for (const item of Array.from(spineItems)) {
    const idref = item.getAttribute("idref");
    const linear = item.getAttribute("linear");
    const properties = item.getAttribute("properties");

    if (idref) {
      spine.push({
        idref,
        linear: linear !== "no",
        properties: properties || undefined,
      });
    }
  }

  return spine;
}

/**
 * Extract table of contents from NCX (EPUB2) or NAV (EPUB3)
 */
async function extractTOC(
  _opfDoc: Document,
  manifest: ManifestItem[],
  files: Record<string, Uint8Array>,
  opfPath: string,
): Promise<TOCItem[]> {
  // Try EPUB3 NAV first
  const navItem = manifest.find(
    (item) =>
      item.properties?.includes("nav") ||
      item.mediaType === "application/xhtml+xml",
  );

  if (navItem) {
    const navContent = files[navItem.href];
    if (navContent) {
      const navDoc = new DOMParser().parseFromString(
        new TextDecoder().decode(navContent),
        "text/html",
      );

      const navElement = navDoc.querySelector('nav[*|type="toc"], nav#toc');
      if (navElement) {
        return parseTOCFromNav(navElement, opfPath);
      }
    }
  }

  // Fallback to EPUB2 NCX
  const ncxItem = manifest.find(
    (item) => item.mediaType === "application/x-dtbncx+xml",
  );

  if (ncxItem) {
    const ncxContent = files[ncxItem.href];
    if (ncxContent) {
      const ncxDoc = new DOMParser().parseFromString(
        new TextDecoder().decode(ncxContent),
        "text/xml",
      );
      return parseTOCFromNCX(ncxDoc, opfPath);
    }
  }

  return [];
}

/**
 * Parse TOC from EPUB3 NAV document
 */
function parseTOCFromNav(navElement: Element, basePath: string): TOCItem[] {
  const toc: TOCItem[] = [];
  const ol = navElement.querySelector("ol");

  if (!ol) return toc;

  function parseList(listElement: Element): TOCItem[] {
    const items: TOCItem[] = [];
    const lis = listElement.querySelectorAll(":scope > li");

    for (const li of Array.from(lis)) {
      const anchor = li.querySelector("a");
      if (anchor) {
        const label = anchor.textContent?.trim() || "";
        const href = resolveHref(anchor.getAttribute("href") || "", basePath);

        const item: TOCItem = { label, href };

        // Check for nested list
        const nestedOl = li.querySelector("ol");
        if (nestedOl) {
          item.children = parseList(nestedOl);
        }

        items.push(item);
      }
    }

    return items;
  }

  return parseList(ol);
}

/**
 * Parse TOC from EPUB2 NCX document
 */
function parseTOCFromNCX(ncxDoc: Document, basePath: string): TOCItem[] {
  function parseNavPoint(navPoint: Element): TOCItem {
    const label =
      navPoint.querySelector("navLabel text")?.textContent?.trim() || "";
    const href = resolveHref(
      navPoint.querySelector("content")?.getAttribute("src") || "",
      basePath,
    );

    const item: TOCItem = { label, href };

    const children = navPoint.querySelectorAll(":scope > navPoint");
    if (children.length > 0) {
      item.children = Array.from(children).map((child) => parseNavPoint(child));
    }

    return item;
  }

  const navPoints = ncxDoc.querySelectorAll("navMap > navPoint");
  return Array.from(navPoints).map((np) => parseNavPoint(np));
}

/**
 * Extract cover image path from EPUB
 * Returns the path to the cover image file within the EPUB structure
 */
function extractCoverImagePath(
  opfDoc: Document,
  manifest: ManifestItem[],
  files: Record<string, Uint8Array>,
): string | undefined {
  // Method 1: Look for cover in metadata
  const metaCover = opfDoc.querySelector('metadata meta[name="cover"]');
  if (metaCover) {
    const coverId = metaCover.getAttribute("content");
    if (coverId) {
      const coverItem = manifest.find((item) => item.id === coverId);
      if (coverItem && files[coverItem.href]) {
        return coverItem.href;
      }
    }
  }

  // Method 2: Look for properties="cover-image" in manifest
  const coverItem = manifest.find((item) =>
    item.properties?.includes("cover-image"),
  );
  if (coverItem && files[coverItem.href]) {
    return coverItem.href;
  }

  // Method 3: Look for common cover file names
  const commonCoverNames = [
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "cover.gif",
  ];
  for (const item of manifest) {
    const fileName = item.href.split("/").pop()?.toLowerCase() || "";
    if (commonCoverNames.includes(fileName) && files[item.href]) {
      return item.href;
    }
  }

  // Method 4: Find first image in manifest
  const firstImage = manifest.find((item) =>
    item.mediaType.startsWith("image/"),
  );
  if (firstImage && files[firstImage.href]) {
    return firstImage.href;
  }

  return undefined;
}

/**
 * Resolve relative href to absolute path within EPUB
 */
function resolveHref(href: string, basePath: string): string {
  // Remove fragment identifier
  const cleanHref = href.split("#")[0];

  if (cleanHref.startsWith("/")) {
    return cleanHref.substring(1);
  }

  const baseDir = basePath.split("/").slice(0, -1).join("/");

  if (baseDir) {
    return `${baseDir}/${cleanHref}`;
  }

  return cleanHref;
}

/**
 * Get media type for a file path
 */
function getMediaType(path: string, manifest: ManifestItem[]): string {
  const manifestItem = manifest.find((item) => item.href === path);
  if (manifestItem) {
    return manifestItem.mediaType;
  }

  // Fallback to extension-based detection
  const ext = path.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    xhtml: "application/xhtml+xml",
    html: "text/html",
    xml: "application/xml",
    css: "text/css",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    svg: "image/svg+xml",
    js: "application/javascript",
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
  };

  return mimeTypes[ext || ""] || "application/octet-stream";
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse EPUB metadata only (without creating Book/BookFile objects)
 * Used for downloading remote books where we already have the files stored
 */
export async function parseEPUBMetadataOnly(
  blob: Blob,
): Promise<ParsedEPUBMetadata> {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Unzip the EPUB file
  const unzipped = await unzipAsync(uint8Array);

  // Parse container.xml to find the OPF file
  const opfPath = await findOPFPath(unzipped);

  if (!opfPath) {
    throw new Error("Could not find OPF file in EPUB");
  }

  const opfContent = new TextDecoder().decode(unzipped[opfPath]);
  const opfDoc = new DOMParser().parseFromString(opfContent, "text/xml");
  const metadata = extractMetadata(opfDoc);
  const manifest = extractManifest(opfDoc, opfPath);
  const spine = extractSpine(opfDoc);
  const toc = await extractTOC(opfDoc, manifest, unzipped, opfPath);
  const coverImagePath = extractCoverImagePath(opfDoc, manifest, unzipped);

  return {
    title: metadata.title || "Unknown Title",
    author: metadata.author || "Unknown Author",
    manifest,
    spine,
    toc,
    coverImagePath,
    metadata: {
      publisher: metadata.publisher,
      language: metadata.language,
      isbn: metadata.isbn,
      description: metadata.description,
      publicationDate: metadata.publicationDate,
    },
  };
}
