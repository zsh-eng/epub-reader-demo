import { describe, expect, it, vi } from "vitest";
import type { Element, Root, RootContent } from "hast";
import type { DiffsHighlighter } from "@pierre/diffs";
import { tokenize } from "@twinkleplop/typescript";
import { createTwinkleplopAdapter, type AdapterTheme } from "../../src/web/highlighting/adapter";
// These tests deliberately guard the version-pinned Pierre adapter boundary.
import { renderFileWithHighlighter } from "@pierre/diffs";
import { renderDiffWithHighlighter } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { createTransformerWithState } from "@pierre/diffs";

const ts = tokenize({ fidelity: "high" });
const themes: Record<string, AdapterTheme> = {
  dark: {
    name: "dark",
    type: "dark",
    colors: { "editor.foreground": "#eeeeee", "editor.background": "#111111" },
    tokenColors: [
      { scope: "keyword", settings: { foreground: "#ff0000" } },
      { scope: "comment", settings: { foreground: "#888888", fontStyle: "italic" } },
      { scope: "string", settings: { foreground: "#00ff00" } },
      { scope: "constant.numeric", settings: { foreground: "#00aaff" } },
    ],
  },
  light: {
    name: "light",
    type: "light",
    fg: "#222222",
    bg: "#ffffff",
    settings: [
      { scope: "keyword", settings: { foreground: "#aa0000", fontStyle: "bold underline" } },
    ],
  },
};
function adapter() {
  return createTwinkleplopAdapter({
    tokenize: (source) => ts(source),
    getTheme: (name) => themes[name],
  });
}
const options = {
  theme: "dark",
  useTokenTransformer: true,
  lineDiffType: "word-alt",
  maxLineDiffLength: 1000,
  tokenizeMaxLineLength: 1000,
} as const;
function content(node: Root | RootContent): string {
  return node.type === "text"
    ? node.value
    : "children" in node
      ? node.children.map(content).join("")
      : "";
}
function elements(node: Root | RootContent): Element[] {
  return [
    ...(node.type === "element" ? [node] : []),
    ...("children" in node ? node.children.flatMap(elements) : []),
  ];
}
const highlighter = () => adapter() as unknown as DiffsHighlighter;

describe("Twinkleplop Pierre adapter", () => {
  it.each(["\n", "\r\n", "\r"])(
    "preserves UTF-16 columns, empty/trailing lines and %j endings in Pierre",
    (ending) => {
      const source = ['const greeting = "😀 café 中文";', "", "export const total = 2;", ""].join(
        ending,
      );
      const rendered = renderFileWithHighlighter(
        { name: "test.ts", contents: source },
        highlighter(),
        options,
      );
      expect(rendered.code).toHaveLength(4);
      expect(rendered.code.map((node) => content(node).replace(/\n$/, ""))).toEqual(
        source.split(ending),
      );
      expect(rendered.code.map((node) => (node as Element).properties["data-line"])).toEqual([
        1, 2, 3, 4,
      ]);
      for (const line of rendered.code) {
        const text = content(line);
        for (const token of elements(line).filter(
          (node) => typeof node.properties["data-char"] === "number",
        )) {
          expect(
            text.slice(token.properties["data-char"] as number).startsWith(content(token)),
          ).toBe(true);
        }
      }
    },
  );

  it("retains original line numbers and word-change decorations across tokens", () => {
    const diff = parsePatchFiles(
      "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -38,3 +38,3 @@\n-export const count = 10;\n+export const count = 20;\n \n export const same = true;\n",
    )[0].files[0];
    const result = renderDiffWithHighlighter(diff, highlighter(), options);
    for (const lines of [result.code.deletionLines, result.code.additionLines])
      expect(lines.map((node) => (node as Element).properties["data-line"])).toEqual([38, 39, 40]);
    const marked = (lines: RootContent[]) =>
      lines
        .flatMap(elements)
        .filter((node) => node.properties["data-diff-span"] !== undefined)
        .map(content)
        .join("");
    expect(marked(result.code.deletionLines)).toBe("10");
    expect(marked(result.code.additionLines)).toBe("20");
    expect((result.code.deletionLines[0] as Element).properties["data-line-type"]).toBe(
      "change-deletion",
    );
    expect((result.code.additionLines[0] as Element).properties["data-line-type"]).toBe(
      "change-addition",
    );
  });

  it("keeps both theme colours and font styles in Pierre's CSS variable contract", () => {
    const rendered = renderFileWithHighlighter(
      { name: "test.ts", contents: "export const count = 2;" },
      highlighter(),
      { ...options, theme: { dark: "dark", light: "light" } },
    );
    const keyword = rendered.code
      .flatMap(elements)
      .find((node) => content(node) === "export" && typeof node.properties.style === "string")!;
    expect(keyword.properties.style).toContain("--diffs-token-dark:#ff0000");
    expect(keyword.properties.style).toContain("--diffs-token-light:#aa0000");
    expect(keyword.properties.style).toContain("--diffs-token-light-font-weight:bold");
    expect(keyword.properties.style).toContain("--diffs-token-light-text-decoration:underline");
    expect(rendered.themeStyles).toContain("--diffs-dark:#eeeeee");
    expect(rendered.themeStyles).toContain("--diffs-light-bg:#ffffff");
  });

  it("retains multiline lexical state after a line exceeds the rendering limit", () => {
    const source = `/* ${"long comment ".repeat(30)}\nstill a comment\n*/\nconst x = 1;`;
    const rendered = adapter().codeToHast(source, {
      lang: "typescript",
      theme: "dark",
      tokenizeMaxLineLength: 40,
    });
    const lines = elements(rendered).filter((node) => node.properties.class === "line");
    expect(lines[0].children).toHaveLength(1);
    expect((lines[0].children[0] as Element).properties.style).toBe("color:#eeeeee");
    expect(
      elements(lines[1]).some((node) => String(node.properties.style).includes("color:#888888")),
    ).toBe(true);
    expect(content(lines[1])).toBe("still a comment");
  });

  it("fills tokenizer gaps and bypasses tokenization for plain text", () => {
    const tokenize = vi.fn<() => { tokens: Uint32Array; token_types: string[] }>(() => ({
      tokens: new Uint32Array([0, 2, 3]),
      token_types: ["number"],
    }));
    const instance = createTwinkleplopAdapter({ tokenize, getTheme: (name) => themes[name] });
    expect(content(instance.codeToHast("  1  ", { lang: "test", theme: "dark" }))).toBe("  1  ");
    expect(content(instance.codeToHast("<script> & 😀", { lang: "text", theme: "dark" }))).toBe(
      "<script> & 😀",
    );
    expect(tokenize).toHaveBeenCalledTimes(1);
    expect(content(instance.codeToHast("", { lang: "text", theme: "dark" }))).toBe("");
  });

  it("supports Pierre's optional style-to-class transformer and its context", () => {
    const { state, transformers, toClass } = createTransformerWithState(true, true);
    state.lineInfo = (line) => ({ type: "context", lineIndex: line - 1, lineNumber: line });
    const root = adapter().codeToHast("const x = 2;", {
      lang: "typescript",
      theme: "dark",
      transformers: transformers as never,
    });
    expect(elements(root).some((node) => String(node.properties.class).startsWith("hl-"))).toBe(
      true,
    );
    expect(toClass.getCSS()).toContain("#ff0000");
  });

  it("supports multi-line decorations without changing selected text", () => {
    const root = adapter().codeToHast("abc def\nghi jkl", {
      lang: "text",
      theme: "dark",
      decorations: [
        {
          start: { line: 0, character: 4 },
          end: { line: 1, character: 3 },
          properties: { "data-selected": true },
        },
      ],
    });
    expect(
      elements(root)
        .filter((node) => node.properties["data-selected"])
        .map(content),
    ).toEqual(["def", "ghi"]);
  });
});
