// Feasibility probe, not a production replacement or general Shiki emulator.
// Implements the hooks used by Pierre 1.4.3's file/diff render utilities.
import { tokenize as ts } from "../../.benchmarks/highlighters/node_modules/@twinkleplop/typescript/dist/index.js";
import { tokenize as tsx } from "../../.benchmarks/highlighters/node_modules/@twinkleplop/tsx/dist/index.js";
import {
  dark,
  light,
} from "../../.benchmarks/highlighters/node_modules/@twinkleplop/theme-github/dist/tokens.js";

const element = (tagName, children = [], properties = {}) => ({
  type: "element",
  tagName,
  properties,
  children,
});
const text = (value) => ({ type: "text", value });
const languages = { typescript: ts({ fidelity: "high" }), tsx: tsx({ fidelity: "high" }) };
const palettes = { "probe-dark": dark, "probe-light": light };

export function createTwinkleplopAdapter() {
  function getTheme(name) {
    const palette = palettes[name];
    if (!palette) throw new Error(`Unsupported probe theme: ${name}`);
    return {
      name,
      type: name.endsWith("dark") ? "dark" : "light",
      fg: palette.identifier,
      bg: palette.background_color,
      colors: {},
    };
  }
  return {
    getTheme,
    codeToHast(source, options) {
      source = source.replace(/\r\n?/g, "\n");
      const tokenizer = languages[options.lang];
      if (!tokenizer && options.lang !== "text")
        throw new Error(`Unsupported probe language: ${options.lang}`);
      const result = tokenizer?.(source);
      const spans = [];
      let cursor = 0;
      if (result)
        for (let i = 0; i < result.tokens.length; i += 3) {
          const [kind, start, end] = result.tokens.subarray(i, i + 3);
          if (start > cursor) spans.push({ start: cursor, end: start, kind: "identifier" });
          spans.push({ start, end, kind: result.token_types[kind] });
          cursor = end;
        }
      if (cursor < source.length)
        spans.push({ start: cursor, end: source.length, kind: "identifier" });
      const transformers = options.transformers ?? [];
      for (const transform of transformers) transform.preprocess?.(source, options);
      let offset = 0;
      let spanIndex = 0;
      const lines = source.split("\n").map((line) => {
        const end = offset + line.length;
        const tokens = [];
        while (spanIndex < spans.length && spans[spanIndex].end <= offset) spanIndex++;
        for (let i = spanIndex; i < spans.length && spans[i].start < end; i++) {
          const span = spans[i];
          const start = Math.max(offset, span.start);
          const stop = Math.min(end, span.end);
          tokens.push({
            content: source.slice(start, stop),
            offset: start,
            __lineChar: start - offset,
            kind: span.kind,
          });
        }
        offset = end + 1;
        return tokens;
      });
      for (const transform of transformers) transform.tokens?.(lines);
      const code = element("code");
      for (const [lineIndex, tokens] of lines.entries()) {
        const line = element("span");
        const decorations = (options.decorations ?? []).filter((d) => d.start.line === lineIndex);
        if (decorations.some((d) => d.end.line !== lineIndex))
          throw new Error("The probe handles Pierre's single-line word decorations only");
        for (const token of tokens) {
          const start = token.__lineChar;
          const end = start + token.content.length;
          const cuts = [
            ...new Set([
              start,
              end,
              ...decorations
                .flatMap((d) => [d.start.character, d.end.character])
                .filter((n) => n > start && n < end),
            ]),
          ].sort((a, b) => a - b);
          for (let i = 0; i < cuts.length - 1; i++) {
            const from = cuts[i];
            const to = cuts[i + 1];
            const colour = (name) => {
              const palette = palettes[name];
              if (!palette) throw new Error(`Unsupported probe theme: ${name}`);
              return palette[token.kind] ?? palette.identifier;
            };
            const style = options.themes
              ? Object.entries(options.themes)
                  .map(
                    ([mode, name]) =>
                      `${options.cssVariablePrefix ?? "--shiki-"}${mode}:${colour(name)}`,
                  )
                  .join(";")
              : `color:${colour(options.theme)}`;
            let span = element("span", [text(token.content.slice(from - start, to - start))], {
              style,
            });
            for (const transform of transformers)
              span = transform.span?.(span, lineIndex + 1, from, line, token) ?? span;
            for (const decoration of decorations)
              if (from >= decoration.start.character && to <= decoration.end.character)
                span = element("span", [span], decoration.properties);
            line.children.push(span);
          }
        }
        for (const transform of transformers) transform.line?.(line, lineIndex + 1);
        code.children.push(line);
      }
      const pre = element("pre", [code]);
      for (const transform of transformers) transform.pre?.(pre);
      return { type: "root", children: [pre] };
    },
  };
}
