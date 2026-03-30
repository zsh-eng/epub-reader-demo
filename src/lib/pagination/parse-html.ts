import type { Block, BlockTag, InlineRun, TextBlock } from "./types";
import { DEFAULT_INTRINSIC_HEIGHT, DEFAULT_INTRINSIC_WIDTH } from "./spacing";

const BLOCK_TAGS = new Set<string>([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "li", "blockquote", "pre", "figcaption",
]);

const CONTAINER_TAGS = new Set<string>([
  "div", "section", "article", "figure", "ul", "ol",
  "header", "footer", "nav", "main", "aside", "details", "summary",
  "dl", "dd", "dt", "span", "hgroup",
]);

const IGNORE_TAGS = new Set<string>(["script", "style", "noscript", "template"]);

interface InlineContext {
  bold: boolean;
  italic: boolean;
  isCode: boolean;
  isLink: boolean;
}

const DEFAULT_CONTEXT: InlineContext = {
  bold: false,
  italic: false,
  isCode: false,
  isLink: false,
};

function runsMatch(a: InlineRun, b: InlineRun): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.isCode === b.isCode &&
    a.isLink === b.isLink
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

function extractInlineRuns(
  node: Node,
  ctx: InlineContext,
  output: InlineRun[],
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    appendRun(output, { text: node.textContent ?? "", ...ctx });
    return;
  }

  if (!(node instanceof HTMLElement)) return;

  const tag = node.tagName.toLowerCase();
  if (IGNORE_TAGS.has(tag)) return;

  if (tag === "br") {
    appendRun(output, { text: "\n", ...ctx });
    return;
  }

  const next: InlineContext = { ...ctx };
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
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function createTextBlock(
  element: HTMLElement,
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

    if (!(node instanceof HTMLElement)) return;

    const tag = node.tagName.toLowerCase();
    if (IGNORE_TAGS.has(tag)) return;

    if (tag === "img") {
      const src = node.getAttribute("src");
      if (!src) return;
      blocks.push({
        type: "image",
        id: `image-${counter.value++}`,
        src,
        alt: node.getAttribute("alt") || undefined,
        intrinsicWidth: parseNumeric(node.getAttribute("width")) ?? DEFAULT_INTRINSIC_WIDTH,
        intrinsicHeight: parseNumeric(node.getAttribute("height")) ?? DEFAULT_INTRINSIC_HEIGHT,
      });
      return;
    }

    if (tag === "hr") {
      blocks.push({ type: "spacer", id: `spacer-${counter.value++}` });
      return;
    }

    if (BLOCK_TAGS.has(tag)) {
      const block = createTextBlock(node, tag as BlockTag, `text-${counter.value++}`);
      if (block) blocks.push(block);
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
