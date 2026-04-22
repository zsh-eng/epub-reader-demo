import ebGaramond400CssText from "@fontsource/eb-garamond/400.css?inline";
import ebGaramond400ItalicCssText from "@fontsource/eb-garamond/400-italic.css?inline";
import ebGaramond500CssText from "@fontsource/eb-garamond/500.css?inline";
import ebGaramond600CssText from "@fontsource/eb-garamond/600.css?inline";
import inter400CssText from "@fontsource/inter/400.css?inline";
import inter500CssText from "@fontsource/inter/500.css?inline";
import inter600CssText from "@fontsource/inter/600.css?inline";
import jetbrainsMono400CssText from "@fontsource/jetbrains-mono/400.css?inline";
import lora400CssText from "@fontsource/lora/400.css?inline";
import lora400ItalicCssText from "@fontsource/lora/400-italic.css?inline";
import lora500CssText from "@fontsource/lora/500.css?inline";
import lora600CssText from "@fontsource/lora/600.css?inline";
import { parseFontFaceRules } from "./font-face-parser";

const PAGINATION_FONT_STYLESHEETS = [
  { label: "@fontsource/inter/400.css", cssText: inter400CssText },
  { label: "@fontsource/inter/500.css", cssText: inter500CssText },
  { label: "@fontsource/inter/600.css", cssText: inter600CssText },
  { label: "@fontsource/eb-garamond/400.css", cssText: ebGaramond400CssText },
  { label: "@fontsource/eb-garamond/500.css", cssText: ebGaramond500CssText },
  { label: "@fontsource/eb-garamond/600.css", cssText: ebGaramond600CssText },
  {
    label: "@fontsource/eb-garamond/400-italic.css",
    cssText: ebGaramond400ItalicCssText,
  },
  { label: "@fontsource/lora/400.css", cssText: lora400CssText },
  { label: "@fontsource/lora/500.css", cssText: lora500CssText },
  { label: "@fontsource/lora/600.css", cssText: lora600CssText },
  {
    label: "@fontsource/lora/400-italic.css",
    cssText: lora400ItalicCssText,
  },
  {
    label: "@fontsource/jetbrains-mono/400.css",
    cssText: jetbrainsMono400CssText,
  },
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

let workerFontsReadyPromise: Promise<void> | null = null;

async function loadPaginationWorkerFonts(): Promise<void> {
  const scope = globalThis as WorkerGlobalScope & { fonts?: FontFaceSet };
  if (!scope.fonts || typeof FontFace === "undefined") return;

  const loadedFaceKeys = new Set<string>();
  const workerBaseUrl = import.meta.url;

  // We bundle the processed CSS text into the worker on purpose. Using `?url`
  // forced the worker to fetch mode-specific payloads: preview served raw CSS,
  // while Vite dev served a JS wrapper around the CSS. `?inline` gives us the
  // same final stylesheet text in both modes, so the worker registers fonts
  // from one consistent representation.
  for (const stylesheet of PAGINATION_FONT_STYLESHEETS) {
    try {
      const rules = parseFontFaceRules(stylesheet.cssText, workerBaseUrl);

      for (const rule of rules) {
        const faceKey = `${rule.family}|${rule.descriptors.style ?? "normal"}|${rule.descriptors.weight ?? "400"}|${rule.descriptors.unicodeRange ?? "all"}`;
        if (loadedFaceKeys.has(faceKey)) continue;
        loadedFaceKeys.add(faceKey);

        const fontFace = new FontFace(rule.family, rule.src, rule.descriptors);
        scope.fonts.add(fontFace);
      }
    } catch (error) {
      console.warn("[pagination worker] Failed to parse font stylesheet", {
        stylesheet: stylesheet.label,
        error,
      });
    }
  }

  await Promise.all(PRELOAD_QUERIES.map((query) => scope.fonts!.load(query)));
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
