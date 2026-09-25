import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** Small, version-checked Pierre integration patch. Baseline builds bypass it. */
export function pierreHighlighter(): Plugin {
  const baseline = process.env.MED_HIGHLIGHTER === "shiki";
  const runtime = JSON.stringify(resolve("src/web/highlighting/runtime.ts"));
  const languages = JSON.stringify(resolve("src/web/highlighting/languages.ts"));
  const compact = JSON.stringify(resolve("src/web/highlighting/compact-file.ts"));
  function replace(source: string, from: string, to: string) {
    if (!source.includes(from))
      throw new Error(`Pierre integration changed; missing ${from.slice(0, 70)}`);
    return source.replace(from, to);
  }
  return {
    name: "med-pierre-twinkleplop",
    enforce: "pre",
    config() {
      return {
        define: {
          "import.meta.env.MED_HIGHLIGHTER": JSON.stringify(baseline ? "shiki" : "twinkleplop"),
        },
      };
    },
    buildStart() {
      const pkg = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.resolve("@pierre/diffs")), "utf8"),
      );
      if (!baseline && pkg.version !== "1.4.3")
        throw new Error("Re-audit the Twinkleplop integration before upgrading Pierre 1.4.3");
    },
    generateBundle(_options, bundle) {
      if (baseline) return;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const id of Object.keys(chunk.modules)) {
          if (/\/@shikijs\/(?:engine-[^/]+|langs)\//.test(id) || /\/oniguruma-to-es\//.test(id))
            throw new Error(`Shiki tokenizer entered the Twinkleplop bundle: ${id}`);
        }
      }
    },
    transform(source, id) {
      if (baseline || !id.includes("/@pierre/diffs/dist/")) return;
      if (id.endsWith("/highlighter/shared_highlighter.js")) {
        source = replace(
          source,
          'from "shiki";',
          `from ${runtime};\nimport { ensureLanguages } from ${languages};`,
        );
        source = replace(
          source,
          "\n\thighlighter ??= createHighlighter({",
          "\n\tawait ensureLanguages(langs, true);\n\thighlighter ??= createHighlighter({",
        );
        source = source.replace(
          'createOnigurumaEngine(import("shiki/wasm"))',
          "createOnigurumaEngine()",
        );
        return source;
      }
      if (id.endsWith("/highlighter/languages/resolveLanguage.js")) {
        return `import { ResolvedLanguages } from "./constants.js";
export async function resolveLanguage(name) {
  let result = ResolvedLanguages.get(name);
  if (!result) { result = { name, data: [{ name, scopeName: 'source.' + name, patterns: [] }] }; ResolvedLanguages.set(name, result); }
  return result;
}`;
      }
      if (id.endsWith("/worker/WorkerPoolManager.js")) {
        // Native workers load their own small grammars. The main thread only
        // needs plaintext while waiting; fallback rendering loads syntax on demand.
        source = replace(
          source,
          "const mainThreadLangs = langs.filter((lang) => !areLanguagesAttached(lang));",
          "const mainThreadLangs = [];",
        );
        // Decode only current file responses, inside Pierre's error boundary.
        source = replace(
          source,
          'case "file": {\n\t\t\t\t\t\tif (task.type !== "file") throw new Error("handleWorkerMessage: task/response dont match");\n\t\t\t\t\t\tconst { result, options } = response;',
          'case "file": {\n\t\t\t\t\t\tif (task.type !== "file") throw new Error("handleWorkerMessage: task/response dont match");\n\t\t\t\t\t\tconst { options } = response;',
        );
        source = replace(
          source,
          "if (!this.isCurrentRenderTask(task) || !areFileRenderOptionsEqual(options, this.getFileRenderOptions())) throw IGNORE_RESPONSE;",
          'if (!this.isCurrentRenderTask(task) || !areFileRenderOptionsEqual(options, this.getFileRenderOptions())) throw IGNORE_RESPONSE;\nconst result = typeof response.result === "string" ? expandCompactFile(JSON.parse(response.result)) : response.result;',
        );
        return `import { expandCompactFile } from ${compact};\n${source}`;
      }
      if (id.endsWith("/worker/worker.js")) {
        // Transfer compact styled lines. The pool constructs HAST lazily for
        // the viewport while preserving the full lexical state of the file.
        source = replace(
          source,
          "\nfunction sendFileSuccess(id, result, options) {",
          "\nfunction sendFileSuccess(id, result, options) {\n\tresult = JSON.stringify(result);",
        );
        source = replace(
          source,
          'import { createHighlighterCore } from "shiki/core";',
          `import { createHighlighterCore, createJavaScriptRegexEngine, createOnigurumaEngine } from ${runtime};`,
        );
        source = replace(
          source,
          'import { createJavaScriptRegexEngine } from "shiki/engine/javascript";',
          "",
        );
        source = replace(
          source,
          'import { createOnigurumaEngine } from "shiki/engine/oniguruma";',
          "",
        );
        source = source.replace(
          'createOnigurumaEngine(import("shiki/wasm"))',
          "createOnigurumaEngine()",
        );
        source = replace(
          source,
          "\n\tconst fileOptions = {",
          "\n\tawait highlighter.prepareSource(file.lang ?? getFiletypeFromFileName(file.name), file.contents);\n\tconst fileOptions = {",
        );
        source = replace(
          source,
          "renderFileWithHighlighter(file, highlighter, fileOptions), fileOptions",
          `compactFile(file.contents, highlighter, {
            lang: file.lang ?? getFiletypeFromFileName(file.name),
            ...(typeof fileOptions.theme === "string" ? { theme: fileOptions.theme } : { themes: fileOptions.theme }),
            cssVariablePrefix: formatCSSVariablePrefix("token"),
            tokenizeMaxLineLength: fileOptions.tokenizeMaxLineLength,
          }, {
            themeStyles: getHighlighterThemeStyles({ theme: fileOptions.theme, highlighter }),
            baseThemeType: typeof fileOptions.theme === "string" ? highlighter.getTheme(fileOptions.theme).type : undefined,
            useTokenTransformer: fileOptions.useTokenTransformer === true,
          }), fileOptions`,
        );
        source = `import { compactFile } from ${compact};\n${source}`;
        source = replace(
          source,
          "\n\tsendDiffSuccess(id,",
          '\n\tawait Promise.all([highlighter.prepareSource(diff.lang ?? getFiletypeFromFileName(diff.name), diff.additionLines.join("")), highlighter.prepareSource(diff.lang ?? getFiletypeFromFileName(diff.prevName ?? diff.name), diff.deletionLines.join(""))]);\n\tsendDiffSuccess(id,',
        );
        return source;
      }
    },
  };
}
