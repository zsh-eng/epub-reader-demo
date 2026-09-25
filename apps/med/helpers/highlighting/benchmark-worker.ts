// Bundler alias selects exactly one production engine per worker bundle.
// @ts-expect-error resolved by the benchmark's Vite build
import { initialize } from "med-benchmark-engine";
import {
  renderFileWithHighlighter,
  renderDiffWithHighlighter,
  parsePatchFiles,
} from "@pierre/diffs";
const begin = performance.now();
const { highlighter, tokens } = await initialize();
postMessage({ ready: true, initializationMs: performance.now() - begin });
onmessage = ({ data }) => {
  try {
    const { source, lang } = data;
    const options = {
      theme: "github-dark",
      useTokenTransformer: true,
      lineDiffType: "word-alt" as const,
      maxLineDiffLength: 1000,
      tokenizeMaxLineLength: Infinity,
    };
    const file = { name: `file.${lang}`, lang, contents: source };
    const lines = source.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
    const patch = `diff --git a/file.${lang} b/file.${lang}\n--- a/file.${lang}\n+++ b/file.${lang}\n@@ -1,${lines.length} +1,${lines.length} @@\n${lines.map((line: string, i: number) => (i === 0 ? `-${line}\n+${line} // review` : ` ${line}`)).join("\n")}\n`;
    const diff = parsePatchFiles(patch)[0].files[0];
    const result: Record<string, number[]> = { tokens: [], file: [], diff: [] };
    const runs = {
      tokens: () => tokens(source, lang),
      file: () => renderFileWithHighlighter(file, highlighter, options),
      diff: () => renderDiffWithHighlighter(diff, highlighter, options),
    };
    const cold = performance.now();
    runs.file();
    const firstFileMs = performance.now() - cold;
    let sink = 0;
    for (const [name, run] of Object.entries(runs)) {
      for (let i = 0; i < 2; i++) run();
      for (let i = 0; i < 7; i++) {
        const t = performance.now();
        const value = run();
        result[name].push(performance.now() - t);
        sink += value ? 1 : 0;
      }
    }
    postMessage({ firstFileMs, samples: result, sink });
  } catch (error) {
    postMessage({ error: String(error) });
  }
};
