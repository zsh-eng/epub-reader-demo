import { parseChapterHtml } from "@/lib/pagination-v2";
import { describe, expect, it } from "vitest";

describe("parseChapterHtml link and target extraction", () => {
  it("preserves normalized internal hrefs and external hrefs on text runs", () => {
    const blocks = parseChapterHtml(`
      <p>
        <a data-epub-link="true" data-epub-href="OEBPS/Text/Chapter2.xhtml#sec-1" href="OEBPS/Text/Chapter2.xhtml#sec-1">Next</a>
        <a href="https://example.com/docs">Docs</a>
      </p>
    `);

    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (!block || block.type !== "text") return;

    const linkedRuns = block.runs.filter((run) => Boolean(run.link));

    expect(linkedRuns).toHaveLength(2);
    expect(linkedRuns[0]?.link).toEqual({
      href: "OEBPS/Text/Chapter2.xhtml#sec-1",
    });
    expect(linkedRuns[1]?.link).toEqual({
      href: "https://example.com/docs",
    });
  });

  it("marks internal-link superscripts as note refs and plain sup as superscript text", () => {
    const blocks = parseChapterHtml(`
      <p>
        studies<a href="#note-12"><sup>12</sup></a>
        H<sup>2</sup>O
      </p>
    `);

    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (!block || block.type !== "text") return;

    const noteRefRun = block.runs.find((run) => run.text === "12");
    const superscriptRun = block.runs.find((run) => run.text === "2");

    expect(noteRefRun).toMatchObject({
      text: "12",
      inlineRole: "note-ref",
      link: { href: "#note-12" },
    });
    expect(superscriptRun).toMatchObject({
      text: "2",
      inlineRole: "superscript",
    });
  });

  it("preserves block target ids from id, xml:id, and name", () => {
    const blocks = parseChapterHtml(`
      <p id="p-1">alpha</p>
      <p xml:id="xml-1">beta</p>
      <p name="named-1">gamma</p>
    `);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ type: "text", targetIds: ["p-1"] });
    expect(blocks[1]).toMatchObject({ type: "text", targetIds: ["xml-1"] });
    expect(blocks[2]).toMatchObject({ type: "text", targetIds: ["named-1"] });
  });

  it("attaches empty inline anchors to the next text run without merging across the target boundary", () => {
    const blocks = parseChapterHtml('<p>ab<a id="note-1"></a>cd</p>');

    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (!block || block.type !== "text") return;

    expect(block.runs).toEqual([
      expect.objectContaining({ kind: "text", text: "ab" }),
      expect.objectContaining({
        kind: "text",
        text: "cd",
        targetIds: ["note-1"],
      }),
    ]);
  });

  it("attaches trailing inline anchors to the preceding text run", () => {
    const blocks = parseChapterHtml('<p>ab<a id="note-1"></a></p>');

    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (!block || block.type !== "text") return;

    expect(block.runs).toEqual([
      expect.objectContaining({
        kind: "text",
        text: "ab",
        targetIds: ["note-1"],
      }),
    ]);
  });

  it("attaches container targets to the first emitted descendant block", () => {
    const blocks = parseChapterHtml(`
      <div id="intro">
        <p>First paragraph.</p>
        <p>Second paragraph.</p>
      </div>
    `);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "text", targetIds: ["intro"] });
    expect(blocks[1]?.type).toBe("text");
    if (!blocks[1] || blocks[1].type !== "text") return;
    expect(blocks[1].targetIds).toBeUndefined();
  });

  it("attaches empty target-only containers to the next emitted block", () => {
    const blocks = parseChapterHtml(`
      <div id="empty-anchor"></div>
      <p>After anchor.</p>
    `);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "text",
      targetIds: ["empty-anchor"],
    });
  });

  it("preserves an isolated empty target-only container when there is no nearby content", () => {
    const blocks = parseChapterHtml('<div id="empty-anchor"></div>');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "text",
      tag: "p",
      targetIds: ["empty-anchor"],
      runs: [],
    });
  });
});
