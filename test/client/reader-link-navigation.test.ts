import { resolvePaginatedLinkTarget } from "@/components/Reader/link-navigation";
import { describe, expect, it } from "vitest";

describe("Reader link navigation", () => {
  const chapterIndexByHrefPath = new Map<string, number>([
    ["OEBPS/Text/Chapter1.xhtml", 0],
    ["OEBPS/Text/Chapter2.xhtml", 1],
  ]);

  it("resolves internal chapter links", () => {
    expect(
      resolvePaginatedLinkTarget(
        "OEBPS/Text/Chapter2.xhtml",
        chapterIndexByHrefPath,
      ),
    ).toEqual({ chapterIndex: 1 });
  });

  it("resolves internal fragment links to chapter index plus target id", () => {
    expect(
      resolvePaginatedLinkTarget(
        "OEBPS/Text/Chapter2.xhtml#note-1",
        chapterIndexByHrefPath,
      ),
    ).toEqual({ chapterIndex: 1, targetId: "note-1" });
  });

  it("returns null for external or unmapped hrefs", () => {
    expect(
      resolvePaginatedLinkTarget(
        "https://example.com/docs",
        chapterIndexByHrefPath,
      ),
    ).toBeNull();
    expect(
      resolvePaginatedLinkTarget(
        "OEBPS/Text/Unknown.xhtml#missing",
        chapterIndexByHrefPath,
      ),
    ).toBeNull();
  });
});
