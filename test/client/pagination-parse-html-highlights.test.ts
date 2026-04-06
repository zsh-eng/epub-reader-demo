import { parseChapterHtml } from "@/lib/pagination-v2";
import { describe, expect, it } from "vitest";

describe("parseChapterHtml highlight extraction", () => {
  it("preserves blockquote block tags", () => {
    const blocks = parseChapterHtml(
      "<blockquote>Quoted text for styling parity.</blockquote>",
    );

    expect(blocks).toHaveLength(1);

    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (!block || block.type !== "text") return;

    expect(block.tag).toBe("blockquote");
    expect(block.runs[0]).toMatchObject({
      text: "Quoted text for styling parity.",
    });
  });

  it("captures highlight mark metadata on inline runs", () => {
    const html =
      '<p>Hello <mark data-highlight-id="h1" data-color="yellow">world</mark>!</p>';

    const blocks = parseChapterHtml(html);
    expect(blocks).toHaveLength(1);

    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (!block || block.type !== "text") return;

    expect(block.runs).toHaveLength(3);
    expect(block.runs[0]).toMatchObject({ text: "Hello " });
    expect(block.runs[1]).toMatchObject({
      text: "world",
      highlightMarks: [{ id: "h1", color: "yellow" }],
    });
    expect(block.runs[2]).toMatchObject({ text: "!" });
  });

  it("keeps nested marks as stacked highlight metadata", () => {
    const html =
      '<p><mark data-highlight-id="h1" data-color="yellow">ab<mark data-highlight-id="h2" data-color="blue">cd</mark>ef</mark></p>';

    const blocks = parseChapterHtml(html);
    expect(blocks).toHaveLength(1);

    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (!block || block.type !== "text") return;

    expect(block.runs).toHaveLength(3);
    expect(block.runs[0]).toMatchObject({
      text: "ab",
      highlightMarks: [{ id: "h1", color: "yellow" }],
    });
    expect(block.runs[1]).toMatchObject({
      text: "cd",
      highlightMarks: [
        { id: "h1", color: "yellow" },
        { id: "h2", color: "blue" },
      ],
    });
    expect(block.runs[2]).toMatchObject({
      text: "ef",
      highlightMarks: [{ id: "h1", color: "yellow" }],
    });
  });

  it("deduplicates repeated nested wrappers with the same highlight id", () => {
    const html =
      '<p><mark data-highlight-id="h1"><span><mark data-highlight-id="h1">x</mark></span></mark></p>';

    const blocks = parseChapterHtml(html);
    expect(blocks).toHaveLength(1);

    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (!block || block.type !== "text") return;

    expect(block.runs).toHaveLength(1);
    expect(block.runs[0]).toMatchObject({
      text: "x",
      highlightMarks: [{ id: "h1" }],
    });
  });
});
