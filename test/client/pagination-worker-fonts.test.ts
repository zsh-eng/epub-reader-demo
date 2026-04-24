import { parseFontFaceRules } from "@/lib/pagination-v2/worker/font-face-parser";
import { describe, expect, it } from "vitest";

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
});
