import { parseCssDeclarations } from "./font-face-parser";
import type { BookStylesheet } from "./types";

export interface CssRule {
  selector: string;
  declarations: Map<string, string>;
  specificity: number;
  order: number;
}

export interface CascadedStyle {
  declarations: Map<string, string>;
}

interface ParseCssRulesOptions {
  includeDeclarations?: (declarations: Map<string, string>) => boolean;
}

export function cleanCssValue(value: string | undefined): string | undefined {
  return value?.replace(/\s*!important\s*$/i, "").trim() || undefined;
}

export function stripCssComments(cssText: string): string {
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

export function parseCssRules(
  stylesheets: readonly BookStylesheet[],
  options: ParseCssRulesOptions = {},
): CssRule[] {
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
      if (options.includeDeclarations?.(declarations) === false) continue;

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

function matchesRule(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

export function cascadeDeclarations(
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

export function getElementPath(element: Element): Element[] {
  const path: Element[] = [];
  let current: Element | null = element;

  while (current) {
    path.unshift(current);
    if (current.tagName.toLowerCase() === "body") break;
    current = current.parentElement;
  }

  return path;
}
