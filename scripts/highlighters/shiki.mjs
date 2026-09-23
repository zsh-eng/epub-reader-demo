import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import ts from "@shikijs/langs/typescript";
import tsx from "@shikijs/langs/tsx";
import css from "@shikijs/langs/css";
import json from "@shikijs/langs/json";
import markdown from "@shikijs/langs/markdown";
import theme from "@shikijs/themes/github-dark";

const highlighter = await createHighlighterCore({
  themes: [theme],
  langs: [ts, tsx, css, json, markdown],
  engine: createJavaScriptRegexEngine(),
});
const options = (lang) => ({ lang, theme: "github-dark", tokenizeTimeLimit: 0 });
export const tokens = (source, lang) => highlighter.codeToTokensBase(source, options(lang));
export const html = (source, lang) => highlighter.codeToHtml(source, options(lang));
export const tree = (source, lang) => highlighter.codeToHast(source, options(lang));
export function inspect(source, lang) {
  return highlighter
    .codeToTokensBase(source, { ...options(lang), includeExplanation: true })
    .flatMap((line) =>
      line.map((token) => ({
        start: token.offset,
        end: token.offset + token.content.length,
        type: [
          ...new Set(
            token.explanation?.flatMap((part) => part.scopes.map((scope) => scope.scopeName)) ?? [],
          ),
        ].join(" "),
      })),
    );
}
