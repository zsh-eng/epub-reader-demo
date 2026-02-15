import { EPUB_LINK } from "@/types/reader.types";
import {
  getMimeTypeForContent,
  processEmbeddedResources,
} from "@/lib/epub-resource-utils";
import { describe, expect, it } from "vitest";

describe("getMimeTypeForContent", () => {
  it("uses XHTML parsing for XHTML media type", () => {
    const mimeType = getMimeTypeForContent(
      "application/xhtml+xml",
      "<html><body></body></html>",
    );
    expect(mimeType).toBe("application/xhtml+xml");
  });

  it("falls back to XHTML parsing when content starts with XML declaration", () => {
    const mimeType = getMimeTypeForContent(
      "text/plain",
      '<?xml version="1.0"?><html></html>',
    );
    expect(mimeType).toBe("application/xhtml+xml");
  });

  it("uses HTML parsing for regular HTML content", () => {
    const mimeType = getMimeTypeForContent(
      "text/html",
      "<html><body></body></html>",
    );
    expect(mimeType).toBe("text/html");
  });
});

describe("processEmbeddedResources", () => {
  it("keeps XHTML body content when file contains self-closing script tags", async () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <script type="text/javascript"/>
  </head>
  <body>
    <p>Hello chapter content</p>
  </body>
</html>`;

    const { document, mimeType } = await processEmbeddedResources({
      content,
      mediaType: "application/xhtml+xml",
      basePath: "OEBPS/Text/Introduction.xhtml",
      loadResource: async () => null,
    });

    const body = document.querySelector("body");
    expect(mimeType).toBe("application/xhtml+xml");
    expect(body?.textContent).toContain("Hello chapter content");
    expect(document.querySelector("script")).toBeNull();
  });

  it("removes active scripting attributes and javascript URLs", async () => {
    const content = `<html><body>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onerror="alert(1)" />
      <a href="javascript:alert(1)" onclick="alert(2)">Link</a>
      <svg xmlns="http://www.w3.org/2000/svg">
        <image xlink:href="javascript:alert(3)" />
      </svg>
    </body></html>`;

    const { document } = await processEmbeddedResources({
      content,
      mediaType: "text/html",
      basePath: "OEBPS/Text/Cover.xhtml",
      loadResource: async () => null,
    });

    const img = document.querySelector("img");
    const link = document.querySelector("a");
    const image = document.querySelector("image");

    expect(img?.getAttribute("onerror")).toBeNull();
    expect(link?.getAttribute("onclick")).toBeNull();
    expect(link?.getAttribute("href")).toBeNull();
    expect(image?.getAttribute("xlink:href")).toBeNull();
  });

  it("rewrites internal EPUB links without javascript URLs", async () => {
    const content = `<html><body><a href="Chapter2.xhtml#sec-1">Next</a></body></html>`;

    const { document } = await processEmbeddedResources({
      content,
      mediaType: "text/html",
      basePath: "OEBPS/Text/Chapter1.xhtml",
      loadResource: async () => null,
    });

    const link = document.querySelector("a");
    expect(link?.getAttribute(EPUB_LINK.linkAttribute)).toBe("true");
    expect(link?.getAttribute(EPUB_LINK.hrefAttribute)).toBe(
      "OEBPS/Text/Chapter2.xhtml",
    );
    expect(link?.getAttribute(EPUB_LINK.fragmentAttribute)).toBe("sec-1");
    expect(link?.getAttribute("href")).toBe("#");
  });
});
