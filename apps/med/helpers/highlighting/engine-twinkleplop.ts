import githubDark from "@shikijs/themes/github-dark";
import { createHighlighter } from "../../src/web/highlighting/runtime";
import { tokenize } from "../../src/web/highlighting/languages";
export async function initialize() {
  const h = await createHighlighter();
  h.loadThemeSync(githubDark);
  await h.prepareSource("java", "");
  await h.prepareSource("cpp", "");
  return { highlighter: h, tokens: tokenize };
}
