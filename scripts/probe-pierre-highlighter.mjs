import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createTwinkleplopAdapter } from "./highlighters/pierre-adapter.mjs";
// Private entry points are intentional for this version-pinned experiment.
// Do not use them as med's production integration contract.
import { renderFileWithHighlighter } from "../node_modules/@pierre/diffs/dist/utils/renderFileWithHighlighter.js";
import { renderDiffWithHighlighter } from "../node_modules/@pierre/diffs/dist/utils/renderDiffWithHighlighter.js";
import { parsePatchFiles } from "../node_modules/@pierre/diffs/dist/utils/parsePatchFiles.js";

assert.equal(
  JSON.parse(
    await readFile(new URL("../node_modules/@pierre/diffs/package.json", import.meta.url), "utf8"),
  ).version,
  "1.4.3",
  "Re-audit private renderer contracts before running this probe on another Pierre version",
);

const adapter = createTwinkleplopAdapter();
const options = {
  theme: "probe-dark",
  useTokenTransformer: true,
  lineDiffType: "word-alt",
  maxLineDiffLength: 1000,
  tokenizeMaxLineLength: 1000,
};
const text = (node) =>
  node.type === "text" ? node.value : (node.children?.map(text).join("") ?? "");
const visit = (nodes, predicate) =>
  nodes.flatMap((node) => [
    ...(predicate(node) ? [node] : []),
    ...visit(node.children ?? [], predicate),
  ]);
const checks = [];
const check = (name, test) => {
  test();
  checks.push(name);
};
const fixture =
  'const greeting = "😀 café 中文";\r\n\r\nexport const View = () => <b>{greeting}</b>;\r\n';
const file = renderFileWithHighlighter(
  { name: "fixture.tsx", contents: fixture },
  adapter,
  options,
);
check("CRLF, Unicode, and empty lines preserve four line nodes", () => {
  assert.equal(file.code.length, 4);
  assert.deepEqual(
    file.code.map((node) => text(node).replace(/\n$/, "")),
    fixture.replaceAll("\r\n", "\n").split("\n"),
  );
  assert.deepEqual(
    file.code.map((node) => node.properties["data-line"]),
    [1, 2, 3, 4],
  );
});
check("token column metadata reaches Pierre's line nodes", () => {
  const spans = visit(file.code, (node) => node.properties?.["data-char"] != null);
  assert.ok(spans.length > 5);
  assert.ok(spans.some((node) => node.properties["data-char"] === 17 && text(node).includes("😀")));
});
const diff = parsePatchFiles(
  "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -38,3 +38,3 @@\n-export const count = 10;\n+export const count = 20;\n \n export const same = true;\n",
)[0].files[0];
const rendered = renderDiffWithHighlighter(diff, adapter, options);
check("diff before/after line numbers and change types survive", () => {
  assert.deepEqual(
    rendered.code.deletionLines.map((node) => node.properties["data-line"]),
    [38, 39, 40],
  );
  assert.deepEqual(
    rendered.code.additionLines.map((node) => node.properties["data-line"]),
    [38, 39, 40],
  );
  assert.equal(rendered.code.deletionLines[0].properties["data-line-type"], "change-deletion");
  assert.equal(rendered.code.additionLines[0].properties["data-line-type"], "change-addition");
});
check("Pierre word-diff decorations survive token conversion", () => {
  const marked = (nodes) =>
    visit(nodes, (node) => node.properties?.["data-diff-span"] !== undefined)
      .map(text)
      .join("");
  assert.equal(marked(rendered.code.deletionLines), "10");
  assert.equal(marked(rendered.code.additionLines), "20");
});
check("dual light/dark token colours and theme surfaces survive", () => {
  const dual = renderFileWithHighlighter({ name: "file.ts", contents: "const x = 1;" }, adapter, {
    ...options,
    theme: { dark: "probe-dark", light: "probe-light" },
  });
  assert.ok(dual.themeStyles.includes("--diffs-dark:"));
  const spans = visit(dual.code, (node) => node.properties?.style?.includes("--diffs-token-dark:"));
  assert.ok(spans.length > 0);
  assert.ok(spans.every((node) => node.properties.style.includes("--diffs-token-light:")));
});
check("unimplemented languages fail explicitly; no hidden Shiki fallback", () => {
  assert.throws(
    () =>
      renderFileWithHighlighter({ name: "file.cpp", contents: "int main() {}" }, adapter, options),
    /Unsupported probe language: cpp/,
  );
});
await mkdir(".benchmarks/highlighters", { recursive: true });
await writeFile(
  ".benchmarks/highlighters/pierre-probe.json",
  JSON.stringify(
    {
      pierre: "1.4.3",
      checks,
      scope: "File/diff utility boundary only; no application worker/cache/UI integration",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
