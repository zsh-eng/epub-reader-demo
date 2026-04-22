export interface ParsedFontFaceRule {
  family: string;
  src: string;
  descriptors: FontFaceDescriptors;
}

function stripQuotes(value: string): string {
  const normalized = value.replace(/\s*!important\s*$/i, "").trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

// Preview builds can inline small font files as `data:` URLs, which means the
// `src:` descriptor may legally contain semicolons. We split declarations with
// a tiny state machine so `url(data:font/woff2;base64,...)` stays intact.
function splitCssDeclarations(block: string): string[] {
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

function parseDeclarations(block: string): Map<string, string> {
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
    const declarations = parseDeclarations(match[1]);
    const family = declarations.get("font-family");
    const src = declarations.get("src");
    if (!family || !src) continue;

    const descriptors: FontFaceDescriptors = {};
    const style = declarations.get("font-style");
    const weight = declarations.get("font-weight");
    const display = declarations.get("font-display");
    const unicodeRange = declarations.get("unicode-range");

    if (style) descriptors.style = stripQuotes(style);
    if (weight) descriptors.weight = stripQuotes(weight);
    if (display) {
      descriptors.display = stripQuotes(
        display,
      ) as FontFaceDescriptors["display"];
    }
    if (unicodeRange) descriptors.unicodeRange = stripQuotes(unicodeRange);

    rules.push({
      family: stripQuotes(family),
      src: resolveSrcUrls(src, baseUrl),
      descriptors,
    });
  }

  return rules;
}
