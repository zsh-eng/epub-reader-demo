/**
 * Parse chapter HTML into pagination `Block[]`.
 *
 * This parser is intentionally opinionated and only materializes the subset of
 * HTML needed by the pagination pipeline.
 *
 * Parsing contract:
 * - Block-level text nodes are produced for tags in `BLOCK_TAGS`.
 * - Container nodes in `CONTAINER_TAGS` are traversed recursively.
 * - Nodes in `IGNORE_TAGS` are dropped entirely.
 * - Images are extracted from:
 *   - `<img src="...">`
 *   - SVG `<image href|xlink:href="...">`
 * - Inline images mixed with text are not supported by pagination v2.
 *   Image-only wrappers like `<p><img /></p>` are still lifted out as block
 *   images during tree walking.
 * - Image sizing prefers numeric `width`/`height`, then
 *   `data-epub-intrinsic-width` / `data-epub-intrinsic-height`, then defaults.
 * - Inline formatting currently preserved in runs:
 *   - bold (`<strong>`, `<b>`)
 *   - italic (`<em>`, `<i>`)
 *   - link (`<a>`)
 *   - code (`<code>`, `<kbd>`, `<samp>`)
 *   - hard break (`<br>`)
 * - Highlight metadata is captured from mark wrappers that provide
 *   `data-highlight-id` (and optional `data-color`). Nested marks are preserved
 *   as an ordered stack in `highlightMarks`.
 *
 * Important dependency notes:
 * - This stage preserves text and mark boundaries; whitespace normalization and
 *   collapsing happen later in `prepare-blocks.ts`.
 * - If supported HTML semantics change in Reader rendering, update this module's
 *   tag sets and inline extraction rules so pagination output stays consistent.
 */
import {
  createDeferredEpubImageSrc,
  DEFERRED_EPUB_IMAGE_ATTR,
} from "@/lib/epub-resource-utils";
import type {
  Block,
  BlockTag,
  HighlightMark,
  InlineRun,
  TextBlock,
} from "./types";
import { DEFAULT_INTRINSIC_HEIGHT, DEFAULT_INTRINSIC_WIDTH } from "./spacing";

const BLOCK_TAGS = new Set<string>([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "figcaption",
]);

const CONTAINER_TAGS = new Set<string>([
  "div",
  "section",
  "article",
  "figure",
  "ul",
  "ol",
  "header",
  "footer",
  "nav",
  "main",
  "aside",
  "details",
  "summary",
  "dl",
  "dd",
  "dt",
  "span",
  "hgroup",
]);

const IGNORE_TAGS = new Set<string>([
  "script",
  "style",
  "noscript",
  "template",
]);

interface InlineContext {
  bold: boolean;
  italic: boolean;
  isCode: boolean;
  isLink: boolean;
  highlightMarks: HighlightMark[];
}

const DEFAULT_CONTEXT: InlineContext = {
  bold: false,
  italic: false,
  isCode: false,
  isLink: false,
  highlightMarks: [],
};

function marksMatch(
  a: HighlightMark[] | undefined,
  b: HighlightMark[] | undefined,
) {
  if (!a || a.length === 0) return !b || b.length === 0;
  if (!b || b.length !== a.length) return false;

  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.id !== right.id || left.color !== right.color) return false;
  }

  return true;
}

function runsMatch(a: InlineRun, b: InlineRun): boolean {
  return (
    (a.hardBreak ?? false) === (b.hardBreak ?? false) &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.isCode === b.isCode &&
    a.isLink === b.isLink &&
    marksMatch(a.highlightMarks, b.highlightMarks)
  );
}

function appendRun(runs: InlineRun[], run: InlineRun): void {
  if (!run.text) return;
  const prev = runs[runs.length - 1];
  if (prev && runsMatch(prev, run)) {
    prev.text += run.text;
    return;
  }
  runs.push(run);
}

function readHighlightMark(element: Element): HighlightMark | null {
  const id = element.getAttribute("data-highlight-id")?.trim();
  if (!id) return null;

  const color = element.getAttribute("data-color")?.trim() || undefined;
  return {
    id,
    ...(color ? { color } : {}),
  };
}

function extractInlineRuns(
  node: Node,
  ctx: InlineContext,
  output: InlineRun[],
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    appendRun(output, {
      text: node.textContent ?? "",
      ...ctx,
      highlightMarks:
        ctx.highlightMarks.length > 0 ? [...ctx.highlightMarks] : undefined,
    });
    return;
  }

  if (!(node instanceof Element)) return;

  const tag = node.tagName.toLowerCase();
  if (IGNORE_TAGS.has(tag)) return;

  if (tag === "br") {
    appendRun(output, { text: "\n", hardBreak: true, ...ctx });
    return;
  }

  if (tag === "img" || tag === "image") {
    // Inline images are intentionally unsupported in the text-layout pipeline.
    // If a block-level wrapper contains only images, walk() will still revisit
    // them and lift them out as standalone image blocks.
    return;
  }

  const next: InlineContext = {
    ...ctx,
    highlightMarks: [...ctx.highlightMarks],
  };

  const highlightMark = readHighlightMark(node);
  if (highlightMark) {
    const alreadyActive = next.highlightMarks.some(
      (mark) => mark.id === highlightMark.id,
    );
    if (!alreadyActive) {
      next.highlightMarks.push(highlightMark);
    }
  }

  if (tag === "strong" || tag === "b") next.bold = true;
  if (tag === "em" || tag === "i") next.italic = true;
  if (tag === "a") next.isLink = true;
  if (tag === "code" || tag === "kbd" || tag === "samp") next.isCode = true;

  for (const child of Array.from(node.childNodes)) {
    extractInlineRuns(child, next, output);
  }
}

function parseNumeric(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    return null;
  }

  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }

  return n;
}

function getImageSource(element: Element, tag: string): string | null {
  const deferredPath = element.getAttribute(DEFERRED_EPUB_IMAGE_ATTR)?.trim();
  if (deferredPath) {
    return createDeferredEpubImageSrc(deferredPath);
  }

  if (tag === "img") {
    return element.getAttribute("src");
  }

  if (tag !== "image") {
    return null;
  }

  return (
    element.getAttribute("href") ??
    element.getAttribute("xlink:href") ??
    element.getAttributeNS("http://www.w3.org/1999/xlink", "href")
  );
}

function createImageBlock(element: Element, id: string): Block | null {
  const tag = element.tagName.toLowerCase();
  const src = getImageSource(element, tag);
  if (!src) return null;

  const intrinsicWidth =
    parseNumeric(element.getAttribute("width")) ??
    parseNumeric(element.getAttribute("data-epub-intrinsic-width")) ??
    DEFAULT_INTRINSIC_WIDTH;
  const intrinsicHeight =
    parseNumeric(element.getAttribute("height")) ??
    parseNumeric(element.getAttribute("data-epub-intrinsic-height")) ??
    DEFAULT_INTRINSIC_HEIGHT;

  return {
    type: "image",
    id,
    src,
    alt: element.getAttribute("alt") || undefined,
    intrinsicWidth,
    intrinsicHeight,
  };
}

function createTextBlock(
  element: Element,
  tag: BlockTag,
  id: string,
): TextBlock | null {
  const runs: InlineRun[] = [];
  for (const child of Array.from(element.childNodes)) {
    extractInlineRuns(child, DEFAULT_CONTEXT, runs);
  }

  const filtered = runs.filter((r) => r.text.length > 0);
  const combined = filtered.map((r) => r.text).join("");
  if (!combined.trim()) return null;

  return { type: "text", id, tag, runs: filtered };
}

export function parseChapterHtml(html: string): Block[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const blocks: Block[] = [];
  const counter = { value: 1 };

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text.trim()) return;

      const p = document.createElement("p");
      p.textContent = text;
      const block = createTextBlock(p, "p", `text-${counter.value++}`);
      if (block) blocks.push(block);
      return;
    }

    if (!(node instanceof Element)) return;

    const tag = node.tagName.toLowerCase();
    if (IGNORE_TAGS.has(tag)) return;

    const imageBlock = createImageBlock(node, `image-${counter.value}`);
    if (imageBlock) {
      counter.value += 1;
      blocks.push(imageBlock);
      return;
    }

    if (tag === "hr") {
      blocks.push({
        type: "spacer",
        id: `spacer-${counter.value++}`,
      });
      return;
    }

    if (BLOCK_TAGS.has(tag)) {
      const block = createTextBlock(
        node,
        tag as BlockTag,
        `text-${counter.value++}`,
      );
      if (block) {
        blocks.push(block);
        return;
      }

      // Some books wrap cover images in heading/paragraph tags.
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      }
      return;
    }

    if (tag === "table") {
      const p = document.createElement("p");
      p.textContent = node.textContent;
      const block = createTextBlock(p, "p", `text-${counter.value++}`);
      if (block) blocks.push(block);
      return;
    }

    if (CONTAINER_TAGS.has(tag)) {
      for (const child of Array.from(node.childNodes)) {
        walk(child);
      }
      return;
    }

    // Unknown elements: recurse into children
    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }
  }

  for (const child of Array.from(doc.body.childNodes)) {
    walk(child);
  }

  return blocks;
}
