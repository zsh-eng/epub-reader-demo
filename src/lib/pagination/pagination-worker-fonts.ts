import ebGaramond400CssUrl from "@fontsource/eb-garamond/400.css?url";
import ebGaramond400ItalicCssUrl from "@fontsource/eb-garamond/400-italic.css?url";
import ebGaramond500CssUrl from "@fontsource/eb-garamond/500.css?url";
import ebGaramond600CssUrl from "@fontsource/eb-garamond/600.css?url";
import inter400CssUrl from "@fontsource/inter/400.css?url";
import inter500CssUrl from "@fontsource/inter/500.css?url";
import inter600CssUrl from "@fontsource/inter/600.css?url";
import jetbrainsMono400CssUrl from "@fontsource/jetbrains-mono/400.css?url";
import lora400CssUrl from "@fontsource/lora/400.css?url";
import lora400ItalicCssUrl from "@fontsource/lora/400-italic.css?url";
import lora500CssUrl from "@fontsource/lora/500.css?url";
import lora600CssUrl from "@fontsource/lora/600.css?url";

const PAGINATION_FONT_STYLESHEET_URLS = [
  inter400CssUrl,
  inter500CssUrl,
  inter600CssUrl,
  ebGaramond400CssUrl,
  ebGaramond500CssUrl,
  ebGaramond600CssUrl,
  ebGaramond400ItalicCssUrl,
  lora400CssUrl,
  lora500CssUrl,
  lora600CssUrl,
  lora400ItalicCssUrl,
  jetbrainsMono400CssUrl,
] as const;

const PRELOAD_QUERIES = [
  'normal 400 16px "Inter"',
  'normal 500 16px "Inter"',
  'normal 600 16px "Inter"',
  'normal 400 16px "EB Garamond"',
  'normal 500 16px "EB Garamond"',
  'normal 600 16px "EB Garamond"',
  'italic 400 16px "EB Garamond"',
  'normal 400 16px "Lora"',
  'normal 500 16px "Lora"',
  'normal 600 16px "Lora"',
  'italic 400 16px "Lora"',
  'normal 400 16px "JetBrains Mono"',
] as const;

interface ParsedFontFaceRule {
  family: string;
  src: string;
  descriptors: FontFaceDescriptors;
}

let workerFontsReadyPromise: Promise<void> | null = null;

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

function parseDeclarations(block: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const declarationPattern = /([a-z-]+)\s*:\s*([^;]+);/gi;

  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(block)) !== null) {
    declarations.set(match[1].toLowerCase(), match[2].trim());
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

function parseFontFaceRules(cssText: string, baseUrl: string): ParsedFontFaceRule[] {
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
      descriptors.display = stripQuotes(display) as FontFaceDescriptors["display"];
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

async function loadStylesheetText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load stylesheet ${url} (${response.status})`);
  }
  return response.text();
}

async function loadPaginationWorkerFonts(): Promise<void> {
  const scope = globalThis as WorkerGlobalScope & { fonts?: FontFaceSet };
  if (!scope.fonts || typeof FontFace === "undefined") return;

  const loadedFaceKeys = new Set<string>();

  for (const cssUrl of PAGINATION_FONT_STYLESHEET_URLS) {
    try {
      const cssText = await loadStylesheetText(cssUrl);
      const rules = parseFontFaceRules(cssText, cssUrl);

      for (const rule of rules) {
        const faceKey = `${rule.family}|${rule.descriptors.style ?? "normal"}|${rule.descriptors.weight ?? "400"}|${rule.descriptors.unicodeRange ?? "all"}`;
        if (loadedFaceKeys.has(faceKey)) continue;
        loadedFaceKeys.add(faceKey);

        const fontFace = new FontFace(rule.family, rule.src, rule.descriptors);
        scope.fonts.add(fontFace);
      }
    } catch (error) {
      console.warn("[pagination worker] Failed to parse font stylesheet", {
        cssUrl,
        error,
      });
    }
  }

  await Promise.all(
    PRELOAD_QUERIES.map((query) => scope.fonts!.load(query)),
  );
}

export function ensurePaginationWorkerFontsReady(): Promise<void> {
  if (workerFontsReadyPromise !== null) {
    return workerFontsReadyPromise;
  }

  workerFontsReadyPromise = loadPaginationWorkerFonts().catch((error) => {
    console.warn("[pagination worker] Falling back to system fonts", error);
  });

  return workerFontsReadyPromise;
}
