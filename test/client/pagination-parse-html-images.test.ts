import { parseChapterHtml } from "@/lib/pagination/parse-html";
import { describe, expect, it } from "vitest";

describe("parseChapterHtml image extraction", () => {
  it("keeps cover images nested inside heading tags", () => {
    const html = `
      <h1 class="cubierta" title="Book One: The Way of Kings">
        <img alt="book1" src="../Images/book1.jpg" />
      </h1>
    `;

    const blocks = parseChapterHtml(html);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "image",
      src: "../Images/book1.jpg",
      alt: "book1",
    });
  });

  it("keeps cover images nested inside svg image tags", () => {
    const html = `
      <div class="x-ebookmaker-cover">
        <svg xmlns="http://www.w3.org/2000/svg"
             xmlns:xlink="http://www.w3.org/1999/xlink"
             viewBox="0 0 1500 2114"
             width="100%"
             height="100%">
          <image width="1500"
                 height="2114"
                 xlink:href="1098001722820821904_cover.jpg" />
        </svg>
      </div>
    `;

    const blocks = parseChapterHtml(html);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "image",
      src: "1098001722820821904_cover.jpg",
      intrinsicWidth: 1500,
      intrinsicHeight: 2114,
    });
  });
});
