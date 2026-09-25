import { createHighlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
export async function initialize() {
  const h = await createHighlighter({
    themes: ["github-dark"],
    langs: ["java", "cpp"],
    engine: createJavaScriptRegexEngine(),
  });
  return {
    highlighter: h,
    tokens: (source: string, lang: string) =>
      h.codeToTokensBase(source, { lang, theme: "github-dark" }),
  };
}
