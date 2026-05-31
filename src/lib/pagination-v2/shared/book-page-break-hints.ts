import { parseCssDeclarations } from "./font-face-parser";
import {
  cascadeDeclarations,
  cleanCssValue,
  parseCssRules,
  type CascadedStyle,
} from "./css-cascade";
import type { BookPageBreakHints, BookStylesheet } from "./types";

export interface BookPageBreakHintResolver {
  resolvePageBreakHints: (element: Element) => BookPageBreakHints | undefined;
}

const PAGE_BREAK_HINT_PROPERTIES = new Set([
  "break-before",
  "break-after",
  "break-inside",
  "page-break-before",
  "page-break-after",
  "page-break-inside",
]);

function hasPageBreakHintDeclarations(declarations: Map<string, string>): boolean {
  for (const property of PAGE_BREAK_HINT_PROPERTIES) {
    if (declarations.has(property)) return true;
  }
  return false;
}

function normalizeBreakValue(value: string | undefined): string | undefined {
  return cleanCssValue(value)?.toLowerCase();
}

function parsePageBreak(value: string | undefined): "page" | undefined {
  switch (normalizeBreakValue(value)) {
    case "always":
    case "page":
    case "left":
    case "right":
    case "recto":
    case "verso":
      return "page";
    default:
      return undefined;
  }
}

function parseBreakAfter(
  declarations: Map<string, string>,
): BookPageBreakHints["breakAfter"] | undefined {
  const modern = normalizeBreakValue(declarations.get("break-after"));
  if (modern === "avoid") return "avoid";

  const legacy = normalizeBreakValue(declarations.get("page-break-after"));
  if (legacy === "avoid") return "avoid";

  return (
    parsePageBreak(declarations.get("break-after")) ??
    parsePageBreak(declarations.get("page-break-after"))
  );
}

function parseBreakInside(
  declarations: Map<string, string>,
): BookPageBreakHints["breakInside"] | undefined {
  const modern = normalizeBreakValue(declarations.get("break-inside"));
  if (modern === "avoid") return "avoid";

  const legacy = normalizeBreakValue(declarations.get("page-break-inside"));
  if (legacy === "avoid") return "avoid";

  return undefined;
}

function parsePageBreakHintsFromDeclarations(
  declarations: Map<string, string>,
): BookPageBreakHints | undefined {
  const breakBefore =
    parsePageBreak(declarations.get("break-before")) ??
    parsePageBreak(declarations.get("page-break-before"));
  const breakAfter = parseBreakAfter(declarations);
  const breakInside = parseBreakInside(declarations);

  if (!breakBefore && !breakAfter && !breakInside) return undefined;
  return {
    ...(breakBefore ? { breakBefore } : {}),
    ...(breakAfter ? { breakAfter } : {}),
    ...(breakInside ? { breakInside } : {}),
  };
}

function readInlineDeclarations(element: Element): Map<string, string> | null {
  const inlineStyle = element.getAttribute("style")?.trim();
  if (!inlineStyle) return null;

  const declarations = parseCssDeclarations(inlineStyle);
  return declarations.size > 0 ? declarations : null;
}

function mergeInlineDeclarations(
  cascaded: CascadedStyle,
  element: Element,
): Map<string, string> {
  const inlineDeclarations = readInlineDeclarations(element);
  if (!inlineDeclarations) return cascaded.declarations;

  return new Map([...cascaded.declarations, ...inlineDeclarations]);
}

/**
 * Book Page Break Hints are structural, not decorative: they shape where page
 * breaks may occur even when Publisher Book Styling is disabled. Keep this
 * resolver intentionally narrow so loading linked CSS for hints does not turn
 * into broad publisher styling or font work.
 */
export function createBookPageBreakHintResolver(
  doc: Document,
  stylesheets: readonly BookStylesheet[],
): BookPageBreakHintResolver | null {
  const rules = parseCssRules(stylesheets, {
    includeDeclarations: hasPageBreakHintDeclarations,
  });
  if (rules.length === 0 && doc.querySelector("[style]") === null) return null;

  const cascadedCache = new WeakMap<Element, CascadedStyle>();
  const getCascadedStyle = (element: Element): CascadedStyle => {
    const cached = cascadedCache.get(element);
    if (cached) return cached;

    const cascaded = cascadeDeclarations(element, rules);
    cascadedCache.set(element, cascaded);
    return cascaded;
  };

  return {
    resolvePageBreakHints(element) {
      if (!doc.body.contains(element)) return undefined;
      const declarations = mergeInlineDeclarations(
        getCascadedStyle(element),
        element,
      );
      return parsePageBreakHintsFromDeclarations(declarations);
    },
  };
}
