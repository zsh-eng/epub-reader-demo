import {
  buildReaderChapterCachedContent,
  buildReaderChapterLoadOrder,
} from "@/components/Reader/data/chapter-content-pipeline";
import { describe, expect, it } from "vitest";

describe("reader chapter content pipeline", () => {
  it("loads chapters middle-out from the initial chapter", () => {
    expect(buildReaderChapterLoadOrder(6, 3)).toEqual([3, 4, 2, 5, 1, 0]);
  });

  it("clamps the initial chapter before building the load order", () => {
    expect(buildReaderChapterLoadOrder(3, 99)).toEqual([2, 1, 0]);
    expect(buildReaderChapterLoadOrder(3, -99)).toEqual([0, 1, 2]);
  });

  it("inlines linked publisher font files from EPUB stylesheets", async () => {
    const resources = new Map<string, Blob>([
      [
        "OEBPS/styles/book.css",
        new Blob(
          [
            `
              @font-face {
                font-family: "Oswald-Light";
                src: url(../fonts/Oswald-Light.ttf);
                font-style: normal;
                font-weight: normal;
              }
              .h1 { font-family: "Oswald-Light", sans-serif; }
            `,
          ],
          { type: "text/css" },
        ),
      ],
      [
        "OEBPS/fonts/Oswald-Light.ttf",
        new Blob([new Uint8Array([0, 1, 2, 3])], { type: "font/ttf" }),
      ],
    ]);

    const chapterContent = await buildReaderChapterCachedContent({
      source: `
        <html>
          <head>
            <link href="../styles/book.css" rel="stylesheet" type="text/css"/>
          </head>
          <body><h1 class="h1">Chapter One</h1></body>
        </html>
      `,
      mediaType: "application/xhtml+xml",
      chapter: {
        index: 0,
        spineItemId: "chapter-1",
        href: "OEBPS/Text/chapter-1.xhtml",
        title: "Chapter 1",
      },
      loadResource: async (path) => resources.get(path) ?? null,
      includePublisherResources: true,
    });

    expect(chapterContent.publisherFontFaces).toHaveLength(1);
    expect(chapterContent.publisherFontFaces?.[0]).toMatchObject({
      family: "Oswald-Light",
      descriptors: { style: "normal", weight: "normal" },
    });
    expect(chapterContent.publisherFontFaces?.[0]?.src).toContain(
      'url("data:font/ttf;base64,',
    );
  });

  it("skips publisher stylesheet and font loading unless requested", async () => {
    let resourceLoadCount = 0;

    const chapterContent = await buildReaderChapterCachedContent({
      source: `
        <html>
          <head>
            <link href="../styles/book.css" rel="stylesheet" type="text/css"/>
          </head>
          <body><h1 class="h1">Chapter One</h1></body>
        </html>
      `,
      mediaType: "application/xhtml+xml",
      chapter: {
        index: 0,
        spineItemId: "chapter-1",
        href: "OEBPS/Text/chapter-1.xhtml",
        title: "Chapter 1",
      },
      loadResource: async () => {
        resourceLoadCount += 1;
        return null;
      },
    });

    expect(resourceLoadCount).toBe(0);
    expect(chapterContent.publisherStylesheets).toEqual([]);
    expect(chapterContent.publisherFontFaces).toEqual([]);
  });
});
