import { tokenize as ts } from "@twinkleplop/typescript";
import { tokenize as tsx } from "@twinkleplop/tsx";
import { tokenize as css } from "@twinkleplop/css";
import { tokenize as json } from "@twinkleplop/json";
import { tokenize as markdown } from "@twinkleplop/markdown";
import { to_html } from "@twinkleplop/core";

const languages = Object.fromEntries(
  Object.entries({ typescript: ts, tsx, css, json, markdown }).map(([name, factory]) => [
    name,
    factory({ fidelity: "high" }),
  ]),
);
export const tokens = (source, lang) => languages[lang](source);
export const html = (source, lang) => to_html(source, tokens(source, lang));
export function inspect(source, lang) {
  const result = tokens(source, lang);
  const spans = [];
  for (let i = 0; i < result.tokens.length; i += 3) {
    spans.push({
      start: result.tokens[i + 1],
      end: result.tokens[i + 2],
      type: result.token_types[result.tokens[i]],
    });
  }
  return spans;
}
