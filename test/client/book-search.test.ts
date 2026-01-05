/**
 * Book Search Unit Tests
 *
 * Tests for text extraction and search functionality.
 */

import { describe, it, expect } from "vitest";
import {
    extractPlainText,
    extractContext,
    searchBook,
    type SearchOptions,
} from "@/lib/book-search";
import type { BookTextCache } from "@/lib/db";

describe("extractPlainText", () => {
    it("extracts text content from HTML", () => {
        const html = "<p>Hello <strong>world</strong>!</p>";
        expect(extractPlainText(html)).toBe("Hello world!");
    });

    it("removes script elements", () => {
        const html = '<p>Text</p><script>alert("xss")</script><p>More</p>';
        // Note: textContent concatenates adjacent elements without adding space
        expect(extractPlainText(html)).toBe("TextMore");
    });

    it("removes style elements", () => {
        const html = "<style>body { color: red; }</style><p>Content</p>";
        expect(extractPlainText(html)).toBe("Content");
    });

    it("removes noscript elements", () => {
        const html = "<noscript>Enable JS</noscript><p>Main content</p>";
        expect(extractPlainText(html)).toBe("Main content");
    });

    it("normalizes whitespace", () => {
        const html = "<p>Multiple   spaces\n\nand\nnewlines</p>";
        expect(extractPlainText(html)).toBe("Multiple spaces and newlines");
    });

    it("handles empty HTML", () => {
        expect(extractPlainText("")).toBe("");
    });

    it("handles HTML with only non-content elements", () => {
        const html = "<script>code</script><style>css</style>";
        expect(extractPlainText(html)).toBe("");
    });
});

describe("extractContext", () => {
    const sampleText = "The quick brown fox jumps over the lazy dog. It was a beautiful day.";

    it("extracts context around a match position", () => {
        const context = extractContext(sampleText, 16, 3, 10); // "fox"
        expect(context).toContain("fox");
        expect(context.length).toBeLessThan(sampleText.length);
    });

    it("adds ellipsis at the start when truncated", () => {
        const context = extractContext(sampleText, 30, 5, 10); // "jumps"
        expect(context.startsWith("...")).toBe(true);
    });

    it("adds ellipsis at the end when truncated", () => {
        const context = extractContext(sampleText, 4, 5, 10); // "quick"
        expect(context.endsWith("...")).toBe(true);
    });

    it("does not add ellipsis at the start for beginning of text", () => {
        const context = extractContext(sampleText, 0, 3, 10); // "The"
        expect(context.startsWith("...")).toBe(false);
    });

    it("handles match at the end of text", () => {
        const context = extractContext(sampleText, sampleText.length - 4, 4, 10); // "day."
        expect(context.endsWith("...")).toBe(false);
        expect(context).toContain("day");
    });
});

describe("searchBook", () => {
    const mockChapters: BookTextCache["chapters"] = [
        {
            path: "chapter1.xhtml",
            title: "Chapter 1",
            plainText: "Call me Ishmael. Some years ago—never mind how long precisely.",
            startOffset: 0,
        },
        {
            path: "chapter2.xhtml",
            title: "Chapter 2",
            plainText: "The whale was enormous. Ishmael stared in awe.",
            startOffset: 61,
        },
        {
            path: "chapter3.xhtml",
            title: "Chapter 3",
            plainText: "No matches in this chapter about the sea.",
            startOffset: 107,
        },
    ];

    it("finds all occurrences of a term across chapters", () => {
        const result = searchBook(mockChapters, "Ishmael");
        expect(result.totalMatches).toBe(2);
        expect(result.byChapter.length).toBe(2);
    });

    it("returns matches in correct chapters", () => {
        const result = searchBook(mockChapters, "Ishmael");
        expect(result.byChapter[0].chapterTitle).toBe("Chapter 1");
        expect(result.byChapter[1].chapterTitle).toBe("Chapter 2");
    });

    it("includes context snippets", () => {
        const result = searchBook(mockChapters, "Ishmael");
        expect(result.byChapter[0].matches[0].context).toContain("Ishmael");
    });

    it("is case-insensitive by default", () => {
        const result = searchBook(mockChapters, "ishmael");
        expect(result.totalMatches).toBe(2);
    });

    it("respects caseSensitive option", () => {
        const result = searchBook(mockChapters, "ishmael", { caseSensitive: true });
        expect(result.totalMatches).toBe(0);
    });

    it("respects wholeWord option", () => {
        // "the" should match standalone "the" in chapter 3, but test with a word that doesn't appear standalone
        const result = searchBook(mockChapters, "sea", { wholeWord: true });
        expect(result.totalMatches).toBe(1);
        expect(result.byChapter[0].chapterPath).toBe("chapter3.xhtml");
    });

    it("returns empty results for empty query", () => {
        const result = searchBook(mockChapters, "");
        expect(result.totalMatches).toBe(0);
        expect(result.byChapter.length).toBe(0);
    });

    it("returns empty results for whitespace-only query", () => {
        const result = searchBook(mockChapters, "   ");
        expect(result.totalMatches).toBe(0);
    });

    it("returns empty results when no matches found", () => {
        const result = searchBook(mockChapters, "nonexistent");
        expect(result.totalMatches).toBe(0);
        expect(result.byChapter.length).toBe(0);
    });

    it("includes correct position information", () => {
        const result = searchBook(mockChapters, "Call");
        expect(result.byChapter[0].matches[0].position).toBe(0);
        expect(result.byChapter[0].matches[0].globalPosition).toBe(0);
    });

    it("calculates globalPosition correctly across chapters", () => {
        const result = searchBook(mockChapters, "Ishmael");
        // First Ishmael in chapter 1
        const ch1Match = result.byChapter[0].matches[0];
        expect(ch1Match.globalPosition).toBe(ch1Match.position);

        // Second Ishmael in chapter 2
        const ch2Match = result.byChapter[1].matches[0];
        expect(ch2Match.globalPosition).toBe(61 + ch2Match.position); // 61 is startOffset of chapter 2
    });

    it("handles special regex characters in query", () => {
        const chaptersWithSpecial: BookTextCache["chapters"] = [
            {
                path: "ch1.xhtml",
                title: "Ch 1",
                plainText: "Price is $10.00 (per item)",
                startOffset: 0,
            },
        ];

        // These should not throw and should find the literal text
        const result1 = searchBook(chaptersWithSpecial, "$10.00");
        expect(result1.totalMatches).toBe(1);

        const result2 = searchBook(chaptersWithSpecial, "(per");
        expect(result2.totalMatches).toBe(1);
    });
});
