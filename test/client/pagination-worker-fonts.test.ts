import { parseFontFaceRules } from "@/lib/pagination-v2/shared/font-face-parser";
import { ensurePublisherFontFacesReady } from "@/lib/pagination-v2/shared/publisher-fonts";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalFontFace = globalThis.FontFace;
const originalGlobalFonts = (globalThis as { fonts?: FontFaceSet }).fonts;
const originalDocumentFontsDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "fonts",
);

afterEach(() => {
  Object.defineProperty(globalThis, "FontFace", {
    configurable: true,
    value: originalFontFace,
  });
  Object.defineProperty(globalThis, "fonts", {
    configurable: true,
    value: originalGlobalFonts,
  });
  if (originalDocumentFontsDescriptor) {
    Object.defineProperty(document, "fonts", originalDocumentFontsDescriptor);
  } else {
    delete (document as { fonts?: FontFaceSet }).fonts;
  }
});

describe("Pagination worker font parser", () => {
  it("keeps data URL src descriptors intact", () => {
    const cssText = `
      @font-face {
        font-family: "JetBrains Mono";
        font-style: normal;
        font-display: swap;
        font-weight: 400;
        src: url(data:font/woff2;base64,AAAA;BBBB) format("woff2");
      }
    `;

    const rules = parseFontFaceRules(
      cssText,
      "https://example.com/assets/font.css",
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]?.family).toBe("JetBrains Mono");
    expect(rules[0]?.src).toContain('url("data:font/woff2;base64,AAAA;BBBB")');
    expect(rules[0]?.descriptors.display).toBe("swap");
    expect(rules[0]?.descriptors.weight).toBe("400");
  });

  it("parses multiline declarations with leading whitespace", () => {
    const cssText = `
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-display: swap;
        font-weight: 400;
        src: url(/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2) format('woff2');
        unicode-range: U+0000-00FF;
      }
    `;

    const rules = parseFontFaceRules(
      cssText,
      "https://example.com/node_modules/@fontsource/inter/400.css",
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]?.family).toBe("Inter");
    expect(rules[0]?.src).toBe(
      "url(\"https://example.com/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2\") format('woff2')",
    );
    expect(rules[0]?.descriptors.unicodeRange).toBe("U+0000-00FF");
  });

  it("registers publisher fonts on document.fonts in the window renderer", async () => {
    const add = vi.fn();
    class TestFontFace {
      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors: FontFaceDescriptors,
      ) {}

      async load() {
        return this;
      }
    }

    Object.defineProperty(globalThis, "FontFace", {
      configurable: true,
      value: TestFontFace,
    });
    Object.defineProperty(globalThis, "fonts", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { add },
    });

    await ensurePublisherFontFacesReady([
      {
        family: "Window Renderer Test",
        src: 'url("data:font/ttf;base64,AAAA")',
        descriptors: { weight: "400" },
      },
    ]);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[0]).toBeInstanceOf(TestFontFace);
  });
});
