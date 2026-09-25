// Compare the full-file wire formats using the pinned difficult-page corpus.
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import {
  renderFileWithHighlighter,
  getHighlighterThemeStyles,
  type DiffsHighlighter,
} from "@pierre/diffs";
import theme from "@shikijs/themes/tokyo-night";
import { twinkleplop } from "../helpers/highlighting/parity";
import { compactFile, expandCompactFile } from "../src/web/highlighting/compact-file";
const highlighter = await twinkleplop([theme]);
const corpus = JSON.parse(readFileSync("helpers/highlighting/corpus.json", "utf8"));
const results = [];
for (const file of corpus) {
  const source = readFileSync(`.benchmarks/language-parity/corpus/${file.name}`, "utf8");
  for (const useTokenTransformer of [false, true]) {
    const options = { theme: "tokyo-night", useTokenTransformer, tokenizeMaxLineLength: 1000 };
    const original = renderFileWithHighlighter(
      { name: file.name, contents: source },
      highlighter as unknown as DiffsHighlighter,
      options,
    );
    const packet = compactFile(
      source,
      highlighter,
      {
        lang: file.name.endsWith("java") ? "java" : "cpp",
        theme: options.theme,
        cssVariablePrefix: "--diffs-token-",
        tokenizeMaxLineLength: options.tokenizeMaxLineLength,
      },
      {
        useTokenTransformer,
        themeStyles: getHighlighterThemeStyles({
          theme: options.theme,
          highlighter: highlighter as unknown as DiffsHighlighter,
        }),
        baseThemeType: "dark",
      },
    );
    const wire = JSON.stringify(packet);
    const expanded = expandCompactFile(JSON.parse(wire));
    assert.deepEqual(JSON.parse(JSON.stringify(expanded)), JSON.parse(JSON.stringify(original)));
    results.push({
      file: file.name,
      useTokenTransformer,
      lines: packet.lines.length,
      originalBytes: Buffer.byteLength(JSON.stringify(original)),
      compactBytes: Buffer.byteLength(wire),
      completeHastEqual: true,
    });
  }
}
highlighter.dispose();
console.log(JSON.stringify(results, null, 2));
