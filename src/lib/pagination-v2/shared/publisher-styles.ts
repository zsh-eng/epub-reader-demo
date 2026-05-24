import { parseCssDeclarations, stripCssQuotes } from "./font-face-parser";
import type {
  BlockTag,
  PublisherBlockRole,
  PublisherBox,
  PublisherInlineStyle,
  PublisherLength,
  PublisherStylesheet,
  PublisherTextStyle,
} from "./types";

interface CssRule {
  selector: string;
  declarations: Map<string, string>;
  specificity: number;
  order: number;
}

interface CascadedStyle {
  declarations: Map<string, string>;
}

interface InheritedPublisherStyle {
  fontFamily?: string;
  fontScale: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic" | "oblique";
  lineHeightFactor?: number;
  textAlign?: PublisherTextStyle["textAlign"];
}

export interface PublisherStyleResolver {
  resolveTextStyle: (
    element: Element,
    tag: BlockTag,
  ) => PublisherTextStyle | undefined;
  resolveInlineStyle: (element: Element) => PublisherInlineStyle | undefined;
}

const BASE_FONT_SIZE_PX = 16;

function stripCssComments(cssText: string): string {
  return cssText.replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitSelectorList(selectorText: string): string[] {
  const selectors: string[] = [];
  let current = "";
  let quoteChar: '"' | "'" | null = null;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < selectorText.length; index += 1) {
    const char = selectorText[index];
    if (!char) continue;

    if (quoteChar) {
      current += char;
      if (char === "\\" && index + 1 < selectorText.length) {
        current += selectorText[index + 1];
        index += 1;
        continue;
      }
      if (char === quoteChar) quoteChar = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quoteChar = char;
      current += char;
      continue;
    }

    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);

    if (char === "," && bracketDepth === 0 && parenDepth === 0) {
      const selector = current.trim();
      if (selector) selectors.push(selector);
      current = "";
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) selectors.push(trailing);
  return selectors;
}

function findMatchingBrace(cssText: string, openIndex: number): number {
  let depth = 0;
  let quoteChar: '"' | "'" | null = null;

  for (let index = openIndex; index < cssText.length; index += 1) {
    const char = cssText[index];
    if (!char) continue;

    if (quoteChar) {
      if (char === "\\" && index + 1 < cssText.length) {
        index += 1;
        continue;
      }
      if (char === quoteChar) quoteChar = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quoteChar = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function parseCssRules(stylesheets: readonly PublisherStylesheet[]): CssRule[] {
  const rules: CssRule[] = [];
  let order = 0;

  for (const stylesheet of stylesheets) {
    const cssText = stripCssComments(stylesheet.cssText);
    let cursor = 0;

    while (cursor < cssText.length) {
      const openIndex = cssText.indexOf("{", cursor);
      if (openIndex === -1) break;

      const selectorText = cssText.slice(cursor, openIndex).trim();
      const closeIndex = findMatchingBrace(cssText, openIndex);
      if (closeIndex === -1) break;

      cursor = closeIndex + 1;
      if (!selectorText || selectorText.startsWith("@")) continue;

      const block = cssText.slice(openIndex + 1, closeIndex);
      const declarations = parseCssDeclarations(block);
      if (declarations.size === 0) continue;

      for (const selector of splitSelectorList(selectorText)) {
        rules.push({
          selector,
          declarations,
          specificity: getSelectorSpecificity(selector),
          order: order++,
        });
      }
    }
  }

  return rules;
}

function getSelectorSpecificity(selector: string): number {
  const idCount = (selector.match(/#[\w-]+/g) ?? []).length;
  const classCount = (selector.match(/\.[\w-]+/g) ?? []).length;
  const attrCount = (selector.match(/\[[^\]]+\]/g) ?? []).length;
  const pseudoClassCount = (selector.match(/:(?!:)[\w-]+/g) ?? []).length;
  const tagCount = selector
    .replace(/#[\w-]+/g, " ")
    .replace(/\.[\w-]+/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/:{1,2}[\w-]+(?:\([^)]*\))?/g, " ")
    .split(/[\s>+~]+/)
    .filter((part) => /^[a-zA-Z][\w-]*$/.test(part)).length;

  return (
    idCount * 100 +
    (classCount + attrCount + pseudoClassCount) * 10 +
    tagCount
  );
}

function matchesRule(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function cascadeDeclarations(
  element: Element,
  rules: readonly CssRule[],
): CascadedStyle {
  const chosen = new Map<
    string,
    { value: string; specificity: number; order: number }
  >();

  for (const rule of rules) {
    if (!matchesRule(element, rule.selector)) continue;

    for (const [property, value] of rule.declarations) {
      const current = chosen.get(property);
      if (
        current &&
        (current.specificity > rule.specificity ||
          (current.specificity === rule.specificity &&
            current.order > rule.order))
      ) {
        continue;
      }

      chosen.set(property, {
        value,
        specificity: rule.specificity,
        order: rule.order,
      });
    }
  }

  return {
    declarations: new Map(
      [...chosen.entries()].map(([property, entry]) => [property, entry.value]),
    ),
  };
}

function cleanCssValue(value: string | undefined): string | undefined {
  return value?.replace(/\s*!important\s*$/i, "").trim() || undefined;
}

function parseNumberPrefix(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?|-?\.\d+)/.exec(value.trim());
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLengthToParts(
  value: string | undefined,
): PublisherLength | undefined {
  const clean = cleanCssValue(value);
  if (!clean) return undefined;
  if (clean === "0") return { em: 0 };

  const numeric = parseNumberPrefix(clean);
  if (numeric === null) return undefined;

  if (clean.endsWith("px")) return { em: numeric / BASE_FONT_SIZE_PX };
  if (clean.endsWith("em") || clean.endsWith("rem")) return { em: numeric };
  if (clean.endsWith("%")) return { percent: numeric / 100 };

  return undefined;
}

function combineLengthParts(
  ...lengths: (PublisherLength | undefined)[]
): PublisherLength | undefined {
  let em = 0;
  let percent = 0;
  let hasEm = false;
  let hasPercent = false;

  for (const length of lengths) {
    if (!length) continue;
    if (length.em !== undefined) {
      em += length.em;
      hasEm = true;
    }
    if (length.percent !== undefined) {
      percent += length.percent;
      hasPercent = true;
    }
  }

  if (!hasEm && !hasPercent) return undefined;
  return {
    ...(hasEm ? { em } : {}),
    ...(hasPercent ? { percent } : {}),
  };
}

function parseFontScale(
  value: string | undefined,
  currentScale: number,
): number | undefined {
  const clean = cleanCssValue(value)?.toLowerCase();
  if (!clean) return undefined;

  const namedScales: Record<string, number> = {
    "xx-small": 0.58,
    "x-small": 0.69,
    small: 0.83,
    medium: 1,
    large: 1.2,
    "x-large": 1.44,
    "xx-large": 1.73,
    smaller: currentScale * 0.83,
    larger: currentScale * 1.2,
  };
  if (clean in namedScales) return namedScales[clean];

  const numeric = parseNumberPrefix(clean);
  if (numeric === null || numeric <= 0) return undefined;

  if (clean.endsWith("px")) return numeric / BASE_FONT_SIZE_PX;
  if (clean.endsWith("rem")) return numeric;
  if (clean.endsWith("em")) return currentScale * numeric;
  if (clean.endsWith("%")) return currentScale * (numeric / 100);

  return undefined;
}

function parseLineHeightFactor(
  value: string | undefined,
  fontScale: number,
): number | undefined {
  const clean = cleanCssValue(value)?.toLowerCase();
  if (!clean || clean === "normal") return undefined;

  const numeric = parseNumberPrefix(clean);
  if (numeric === null || numeric <= 0) return undefined;

  if (/^-?\d+(?:\.\d+)?$/.test(clean) || /^-?\.\d+$/.test(clean)) {
    return numeric;
  }
  if (clean.endsWith("em") || clean.endsWith("rem")) return numeric;
  if (clean.endsWith("%")) return numeric / 100;
  if (clean.endsWith("px")) {
    return numeric / Math.max(1, BASE_FONT_SIZE_PX * fontScale);
  }

  return undefined;
}

function parseFontWeight(value: string | undefined): number | undefined {
  const clean = cleanCssValue(value)?.toLowerCase();
  if (!clean) return undefined;
  if (clean === "normal") return 400;
  if (clean === "bold") return 700;

  const numeric = Number.parseInt(clean, 10);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(100, Math.min(900, numeric));
}

function parseFontStyle(
  value: string | undefined,
): PublisherTextStyle["fontStyle"] | undefined {
  const clean = cleanCssValue(value)?.toLowerCase();
  if (!clean) return undefined;
  if (clean.startsWith("italic")) return "italic";
  if (clean.startsWith("oblique")) return "oblique";
  if (clean === "normal") return "normal";
  return undefined;
}

function parseDisplayBlock(value: string | undefined): boolean | undefined {
  const clean = cleanCssValue(value)?.toLowerCase();
  if (!clean) return undefined;
  if (clean === "block") return true;
  return undefined;
}

function parseTextAlign(
  value: string | undefined,
): PublisherTextStyle["textAlign"] | undefined {
  const clean = cleanCssValue(value)?.toLowerCase();
  switch (clean) {
    case "left":
    case "center":
    case "right":
    case "justify":
      return clean;
    default:
      return undefined;
  }
}

function getMarginDeclaration(
  declarations: Map<string, string>,
  side: "top" | "right" | "bottom" | "left",
): string | undefined {
  const direct = declarations.get(`margin-${side}`);
  if (direct !== undefined) return direct;

  const shorthand = declarations.get("margin");
  if (!shorthand) return undefined;

  const parts = shorthand.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) {
    return side === "top" || side === "bottom" ? parts[0] : parts[1];
  }
  if (parts.length === 3) {
    if (side === "top") return parts[0];
    return side === "bottom" ? parts[2] : parts[1];
  }
  return {
    top: parts[0],
    right: parts[1],
    bottom: parts[2],
    left: parts[3],
  }[side];
}

function getPaddingDeclaration(
  declarations: Map<string, string>,
  side: "right" | "left",
): string | undefined {
  const direct = declarations.get(`padding-${side}`);
  if (direct !== undefined) return direct;

  const shorthand = declarations.get("padding");
  if (!shorthand) return undefined;

  const parts = shorthand.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[1];
  if (parts.length === 3) return parts[1];
  return side === "right" ? parts[1] : parts[3];
}

function classText(element: Element): string {
  return element.getAttribute("class")?.toLowerCase() ?? "";
}

function hasClassFragment(element: Element, pattern: RegExp): boolean {
  return pattern.test(classText(element));
}

function isHeadingElement(element: Element, tag: BlockTag): boolean {
  if (/^h[1-6]$/.test(tag)) return true;

  const classes = classText(element);
  return (
    /(^|[\s_-])h[1-6][a-z]?($|[\s_-])/.test(classes) ||
    /(^|[\s_-])(heading|chapter-title|chaptertitle|titlepage-title|titlepage|part-title)($|[\s_-])/.test(
      classes,
    )
  );
}

function resolveRole(element: Element, tag: BlockTag): PublisherBlockRole {
  if (isHeadingElement(element, tag)) return "heading";
  if (tag === "figcaption" || hasClassFragment(element, /caption/)) {
    return "caption";
  }
  if (tag === "li") return "list";
  if (tag === "pre") return "pre";
  if (element.closest("blockquote") || tag === "blockquote") {
    return "blockquote";
  }
  if (hasClassFragment(element, /epigraph/)) return "epigraph";
  if (
    element.closest(".CommentGroup, .commentgroup, aside") ||
    hasClassFragment(element, /(comment|callout|sidebar)/)
  ) {
    return "comment";
  }
  if (hasClassFragment(element, /(note|footnote|endnote)/)) return "note";
  if (
    hasClassFragment(element, /(frontmatter|backmatter|copyright|dedication)/)
  ) {
    return "frontBack";
  }
  return "body";
}

function getElementPath(element: Element): Element[] {
  const path: Element[] = [];
  let current: Element | null = element;

  while (current) {
    path.unshift(current);
    if (current.tagName.toLowerCase() === "body") break;
    current = current.parentElement;
  }

  return path;
}

function applyInheritedDeclarations(
  inherited: InheritedPublisherStyle,
  declarations: Map<string, string>,
): InheritedPublisherStyle {
  const next = { ...inherited };
  const fontScale = parseFontScale(
    declarations.get("font-size"),
    inherited.fontScale,
  );
  if (fontScale !== undefined) next.fontScale = fontScale;

  const fontFamily = cleanCssValue(declarations.get("font-family"));
  if (fontFamily) next.fontFamily = fontFamily;

  const fontWeight = parseFontWeight(declarations.get("font-weight"));
  if (fontWeight !== undefined) next.fontWeight = fontWeight;

  const fontStyle = parseFontStyle(declarations.get("font-style"));
  if (fontStyle) next.fontStyle = fontStyle;

  const lineHeightFactor = parseLineHeightFactor(
    declarations.get("line-height"),
    next.fontScale,
  );
  if (lineHeightFactor !== undefined) {
    next.lineHeightFactor = lineHeightFactor;
  }

  const textAlign = parseTextAlign(declarations.get("text-align"));
  if (textAlign) next.textAlign = textAlign;

  return next;
}

function getAncestorInset(
  element: Element,
  rules: readonly CssRule[],
  side: "left" | "right",
): PublisherLength | undefined {
  let current = element.parentElement;
  let total: PublisherLength | undefined;

  while (current && current.tagName.toLowerCase() !== "body") {
    const role = resolveRole(current, current.tagName.toLowerCase() as BlockTag);
    if (role !== "body" && role !== "list") {
      const declarations = cascadeDeclarations(current, rules).declarations;
      const margin = parseLengthToParts(getMarginDeclaration(declarations, side));
      const padding = parseLengthToParts(
        getPaddingDeclaration(declarations, side),
      );
      total = combineLengthParts(total, margin, padding);
    }

    current = current.parentElement;
  }

  return total;
}

function normalizePublisherStyle(style: PublisherTextStyle): PublisherTextStyle {
  const textIndent = normalizePublisherLength(style.textIndent, {
    maxEm: 6,
    maxPercent: 1,
  });
  const margin = normalizePublisherBox(style.margin);

  return {
    ...style,
    ...(style.fontFamily
      ? { fontFamily: style.fontFamily.replace(/\s+/g, " ").trim() }
      : {}),
    ...(style.fontScale !== undefined
      ? { fontScale: Math.max(0.55, Math.min(4, style.fontScale)) }
      : {}),
    ...(style.lineHeightFactor !== undefined
      ? {
          lineHeightFactor: Math.max(
            0.85,
            Math.min(2.4, style.lineHeightFactor),
          ),
        }
      : {}),
    ...(textIndent ? { textIndent } : {}),
    ...(margin ? { margin } : {}),
  };
}

function normalizePublisherLength(
  length: PublisherLength | undefined,
  limits: { maxEm: number; maxPercent: number },
): PublisherLength | undefined {
  if (!length) return undefined;

  const normalized: PublisherLength = {};
  if (length.em !== undefined) {
    normalized.em = Math.max(0, Math.min(limits.maxEm, length.em));
  }
  if (length.percent !== undefined) {
    normalized.percent = Math.max(
      0,
      Math.min(limits.maxPercent, length.percent),
    );
  }

  if (normalized.em === undefined && normalized.percent === undefined) {
    return undefined;
  }
  return normalized;
}

function normalizePublisherBox(
  box: PublisherBox | undefined,
): PublisherBox | undefined {
  if (!box) return undefined;

  const before = normalizePublisherLength(box.before, {
    maxEm: 12,
    maxPercent: 1.5,
  });
  const after = normalizePublisherLength(box.after, {
    maxEm: 12,
    maxPercent: 1.5,
  });
  const left = normalizePublisherLength(box.left, {
    maxEm: 12,
    maxPercent: 1,
  });
  const right = normalizePublisherLength(box.right, {
    maxEm: 12,
    maxPercent: 1,
  });

  if (!before && !after && !left && !right) return undefined;
  return {
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    ...(left ? { left } : {}),
    ...(right ? { right } : {}),
  };
}

function normalizePublisherInlineStyle(
  style: PublisherInlineStyle,
): PublisherInlineStyle {
  return {
    ...(style.fontFamily
      ? {
          fontFamily: stripCssQuotes(style.fontFamily)
            .replace(/\s+/g, " ")
            .trim(),
        }
      : {}),
    ...(style.fontScale !== undefined
      ? { fontScale: Math.max(0.55, Math.min(4, style.fontScale)) }
      : {}),
    ...(style.fontWeight !== undefined
      ? { fontWeight: style.fontWeight }
      : {}),
    ...(style.fontStyle ? { fontStyle: style.fontStyle } : {}),
    ...(style.displayBlock ? { displayBlock: true } : {}),
  };
}

export function createPublisherStyleResolver(
  doc: Document,
  stylesheets: readonly PublisherStylesheet[],
): PublisherStyleResolver | null {
  if (stylesheets.length === 0) return null;

  const rules = parseCssRules(stylesheets);
  if (rules.length === 0) return null;

  const cascadedCache = new WeakMap<Element, CascadedStyle>();
  const getCascadedStyle = (element: Element): CascadedStyle => {
    const cached = cascadedCache.get(element);
    if (cached) return cached;

    const cascaded = cascadeDeclarations(element, rules);
    cascadedCache.set(element, cascaded);
    return cascaded;
  };

  const resolveElementStyle = (
    element: Element,
  ):
    | {
        inherited: InheritedPublisherStyle;
        targetDeclarations: Map<string, string>;
      }
    | undefined => {
    if (!doc.body.contains(element)) return undefined;

    const path = getElementPath(element);
    let inherited: InheritedPublisherStyle = { fontScale: 1 };
    let targetDeclarations = new Map<string, string>();

    for (const pathElement of path) {
      const declarations = getCascadedStyle(pathElement).declarations;
      inherited = applyInheritedDeclarations(inherited, declarations);
      if (pathElement === element) targetDeclarations = declarations;
    }

    return { inherited, targetDeclarations };
  };

  return {
    resolveTextStyle(element, tag) {
      const resolved = resolveElementStyle(element);
      if (!resolved) return undefined;
      const { inherited, targetDeclarations } = resolved;

      const role = resolveRole(element, tag);
      const targetMarginLeft = parseLengthToParts(
        getMarginDeclaration(targetDeclarations, "left"),
      );
      const targetMarginRight = parseLengthToParts(
        getMarginDeclaration(targetDeclarations, "right"),
      );
      const ancestorMarginLeft = getAncestorInset(element, rules, "left");
      const ancestorMarginRight = getAncestorInset(element, rules, "right");
      const marginLeft = combineLengthParts(
        targetMarginLeft,
        ancestorMarginLeft,
      );
      const marginRight = combineLengthParts(
        targetMarginRight,
        ancestorMarginRight,
      );
      const textIndent = parseLengthToParts(
        targetDeclarations.get("text-indent"),
      );
      const marginBefore = parseLengthToParts(
        getMarginDeclaration(targetDeclarations, "top"),
      );
      const marginAfter = parseLengthToParts(
        getMarginDeclaration(targetDeclarations, "bottom"),
      );

      return normalizePublisherStyle({
        role,
        ...(inherited.fontFamily
          ? { fontFamily: stripCssQuotes(inherited.fontFamily) }
          : {}),
        fontScale: inherited.fontScale,
        ...(inherited.fontWeight !== undefined
          ? { fontWeight: inherited.fontWeight }
          : {}),
        ...(inherited.fontStyle ? { fontStyle: inherited.fontStyle } : {}),
        ...(inherited.lineHeightFactor !== undefined
          ? { lineHeightFactor: inherited.lineHeightFactor }
          : {}),
        ...(inherited.textAlign ? { textAlign: inherited.textAlign } : {}),
        ...(textIndent ? { textIndent } : {}),
        ...(marginBefore || marginAfter || marginLeft || marginRight
          ? {
              margin: {
                ...(marginBefore ? { before: marginBefore } : {}),
                ...(marginAfter ? { after: marginAfter } : {}),
                ...(marginLeft ? { left: marginLeft } : {}),
                ...(marginRight ? { right: marginRight } : {}),
              },
            }
          : {}),
      });
    },
    resolveInlineStyle(element) {
      const resolved = resolveElementStyle(element);
      if (!resolved) return undefined;
      const { inherited, targetDeclarations } = resolved;

      return normalizePublisherInlineStyle({
        ...(inherited.fontFamily ? { fontFamily: inherited.fontFamily } : {}),
        fontScale: inherited.fontScale,
        ...(inherited.fontWeight !== undefined
          ? { fontWeight: inherited.fontWeight }
          : {}),
        ...(inherited.fontStyle ? { fontStyle: inherited.fontStyle } : {}),
        ...(parseDisplayBlock(targetDeclarations.get("display"))
          ? { displayBlock: true }
          : {}),
      });
    },
  };
}
