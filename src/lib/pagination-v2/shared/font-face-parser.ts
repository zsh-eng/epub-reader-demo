export interface ParsedFontFaceRule {
  family: string;
  src: string;
  descriptors: FontFaceDescriptors;
}

export function stripCssQuotes(value: string): string {
  const normalized = value.replace(/\s*!important\s*$/i, "").trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

// `src:` descriptors may contain semicolons inside data URLs, so declarations
// are split with a small state machine instead of `block.split(";")`.
export function splitCssDeclarations(block: string): string[] {
  const declarations: string[] = [];
  let current = "";
  let parenDepth = 0;
  let quoteChar: '"' | "'" | null = null;

  for (let index = 0; index < block.length; index += 1) {
    const char = block[index];
    if (!char) continue;

    current += char;

    if (quoteChar) {
      if (char === "\\" && index + 1 < block.length) {
        current += block[index + 1];
        index += 1;
        continue;
      }

      if (char === quoteChar) {
        quoteChar = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quoteChar = char;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }

    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (char === ";" && parenDepth === 0) {
      const declaration = current.slice(0, -1).trim();
      if (declaration.length > 0) {
        declarations.push(declaration);
      }
      current = "";
    }
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    declarations.push(trailing);
  }

  return declarations;
}

export function parseCssDeclarations(block: string): Map<string, string> {
  const declarations = new Map<string, string>();

  for (const declaration of splitCssDeclarations(block)) {
    const separatorIndex = declaration.indexOf(":");
    if (separatorIndex <= 0) continue;

    const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
    const value = declaration.slice(separatorIndex + 1).trim();
    if (!property || !value) continue;

    declarations.set(property, value);
  }

  return declarations;
}

function resolveSrcUrls(src: string, baseUrl: string): string {
  return src.replace(/url\(([^)]+)\)/gi, (full, rawUrl: string) => {
    const token = rawUrl.trim();
    const unquoted = token.replace(/^['"]|['"]$/g, "");

    try {
      return `url("${new URL(unquoted, baseUrl).href}")`;
    } catch {
      return full;
    }
  });
}

export function parseFontFaceRules(
  cssText: string,
  baseUrl: string,
): ParsedFontFaceRule[] {
  const rules: ParsedFontFaceRule[] = [];
  const fontFacePattern = /@font-face\s*{([^}]*)}/gi;

  let match: RegExpExecArray | null;
  while ((match = fontFacePattern.exec(cssText)) !== null) {
    const declarations = parseCssDeclarations(match[1]);
    const family = declarations.get("font-family");
    const src = declarations.get("src");
    if (!family || !src) continue;

    const descriptors: FontFaceDescriptors = {};
    const style = declarations.get("font-style");
    const weight = declarations.get("font-weight");
    const display = declarations.get("font-display");
    const unicodeRange = declarations.get("unicode-range");

    if (style) descriptors.style = stripCssQuotes(style);
    if (weight) descriptors.weight = stripCssQuotes(weight);
    if (display) {
      descriptors.display = stripCssQuotes(
        display,
      ) as FontFaceDescriptors["display"];
    }
    if (unicodeRange) descriptors.unicodeRange = stripCssQuotes(unicodeRange);

    rules.push({
      family: stripCssQuotes(family),
      src: resolveSrcUrls(src, baseUrl),
      descriptors,
    });
  }

  return rules;
}
