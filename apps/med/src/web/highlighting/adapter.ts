import type { Element, ElementContent, Properties, Root } from "hast";

export interface AdapterTheme {
  name?: string;
  type?: string;
  fg?: string;
  bg?: string;
  colors?: Record<string, string>;
  tokenColors?: ThemeRule[];
  settings?: ThemeRule[];
}
interface ThemeRule {
  scope?: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}
export interface Tokenization {
  tokens: Uint32Array;
  token_types: readonly string[];
}
export interface AdapterOptions {
  tokenize(source: string, lang: string): Tokenization | undefined;
  getTheme(name: string): AdapterTheme;
}
interface Token {
  content: string;
  offset: number;
  __lineChar: number;
  color?: string;
  fontStyle?: number;
  htmlStyle?: Record<string, string>;
  htmlAttrs?: Properties;
}
interface Context {
  addClassToHast(node: Element, ...classes: string[]): Element;
}
interface Transformer {
  preprocess?(this: Context, source: string, options: HighlightOptions): string | void;
  tokens?(this: Context, lines: Token[][]): Token[][] | void;
  span?(
    this: Context,
    node: Element,
    line: number,
    column: number,
    parent: Element,
    token: Token,
  ): Element | void;
  line?(this: Context, node: Element, line: number): Element | void;
  code?(this: Context, node: Element): Element | void;
  pre?(this: Context, node: Element): Element | void;
  root?(this: Context, node: Root): Root | void;
}
interface Decoration {
  start: { line: number; character: number };
  end: { line: number; character: number };
  properties?: Properties;
}
export interface HighlightOptions {
  lang: string;
  theme?: string;
  themes?: Record<string, string>;
  cssVariablePrefix?: string;
  defaultColor?: string | false;
  tokenizeMaxLineLength?: number;
  mergeWhitespaces?: boolean | "never";
  transformers?: Transformer[];
  decorations?: Decoration[];
}
const element = (
  tagName: string,
  children: ElementContent[] = [],
  properties: Properties = {},
): Element => ({ type: "element", tagName, properties, children });

// Twinkleplop has semantic token kinds rather than TextMate scope stacks. Match
// these representative scopes to the user's existing theme without a tokenizer.
const scopes: Record<string, string> = {
  boolean: "constant.language.boolean",
  null: "constant.language.null",
  number: "constant.numeric",
  bit: "constant.numeric",
  keyword: "keyword.control",
  operator: "keyword.operator",
  directive: "keyword.control.directive",
  expression: "keyword.operator",
  comment: "comment",
  doctype: "comment",
  hash: "comment",
  label: "comment",
  string: "string.quoted",
  template: "string.template",
  regex: "string.regexp",
  string_escape: "constant.character.escape",
  escape: "constant.character.escape",
  identifier: "variable.other",
  variable: "variable.other",
  parameter: "variable.parameter",
  property: "variable.other.property",
  constant: "variable.other.constant",
  function: "entity.name.function",
  class_name: "entity.name.type.class",
  type: "entity.name.type",
  namespace: "entity.name.namespace",
  builtin: "support.function",
  variant: "constant.other.enum",
  decorator: "entity.name.function.decorator",
  punctuation: "punctuation",
  attribute: "entity.other.attribute-name",
  attr_name: "entity.other.attribute-name",
  tag_name: "entity.name.tag",
  entity: "constant.character.entity",
  selector: "entity.name.tag",
  selector_class: "entity.other.attribute-name.class",
  selector_id: "entity.other.attribute-name.id",
  selector_pseudo: "entity.other.attribute-name.pseudo-class",
  css_variable: "variable.other",
  unit: "keyword.other.unit",
  heading: "markup.heading",
  heading_marker: "markup.heading",
  bold: "markup.bold",
  italic: "markup.italic",
  strike: "markup.strikethrough",
  code: "markup.inline.raw",
  code_block: "markup.raw.block",
  code_language: "markup.raw.block",
  url: "markup.underline.link",
  url_link: "markup.underline.link",
  autolink: "markup.underline.link",
  link_text: "string.other.link",
  url_title: "string.other.link",
  inserted: "markup.inserted",
  inserted_marker: "markup.inserted",
  deleted: "markup.deleted",
  deleted_marker: "markup.deleted",
  changed: "markup.changed",
  changed_marker: "markup.changed",
  datetime: "constant.numeric",
  lifetime: "storage.modifier",
  tag: "entity.name.tag",
  list_marker: "punctuation.definition.list",
  task_marker: "markup.list",
  blockquote_marker: "punctuation.definition.quote",
};
function fontBits(style: string) {
  return (
    (style.includes("italic") ? 1 : 0) |
    (style.includes("bold") ? 2 : 0) |
    (style.includes("underline") ? 4 : 0) |
    (style.includes("strikethrough") ? 8 : 0)
  );
}
function fontCSS(bits: number): Record<string, string> {
  return {
    "font-style": bits & 1 ? "italic" : "normal",
    "font-weight": bits & 2 ? "bold" : "normal",
    "text-decoration":
      [bits & 4 ? "underline" : "", bits & 8 ? "line-through" : ""].filter(Boolean).join(" ") ||
      "none",
  };
}

/** The version-pinned HAST contract used by Pierre's file and diff renderers. */
export function createTwinkleplopAdapter(dependencies: AdapterOptions) {
  const themes = new Map<
    string,
    AdapterTheme & { name: string; fg: string; bg: string; type: string }
  >();
  const styles = new Map<string, { color: string; fontStyle: number }>();
  function getTheme(name: string) {
    let theme = themes.get(name);
    if (!theme) {
      const raw = dependencies.getTheme(name);
      const defaults = (raw.tokenColors ?? raw.settings ?? [])
        .filter((rule) => !rule.scope)
        .reduce((all, rule) => ({ ...all, ...rule.settings }), {} as ThemeRule["settings"]);
      const type = raw.type ?? "dark";
      theme = {
        ...raw,
        name: raw.name ?? name,
        type,
        colors: raw.colors ?? {},
        fg:
          raw.fg ??
          raw.colors?.["editor.foreground"] ??
          defaults.foreground ??
          (type === "light" ? "#24292e" : "#e1e4e8"),
        bg:
          raw.bg ??
          raw.colors?.["editor.background"] ??
          defaults.background ??
          (type === "light" ? "#ffffff" : "#24292e"),
      };
      themes.set(name, theme);
    }
    return theme;
  }
  function tokenStyle(name: string, kind: string) {
    const key = `${name}\0${kind}`;
    let cached = styles.get(key);
    if (cached) return cached;
    const theme = getTheme(name);
    const scopeStack = kind
      .split("|")
      .map(
        (part) =>
          scopes[part] ??
          scopes[part.replace(/_(?:open|close)$/, "")] ??
          (part.includes(".") ? part : "variable.other"),
      );
    let color = theme.fg;
    let fontStyle = 0;
    let colorRank = -1;
    let fontRank = -1;
    for (const rule of theme.tokenColors ?? theme.settings ?? []) {
      const selectors =
        typeof rule.scope === "string" ? rule.scope.split(",") : (rule.scope ?? [""]);
      for (const entry of selectors) {
        const selector = entry.trim();
        // Parent/negative scope selectors cannot be reconstructed from semantic kinds.
        const depth = selector
          ? scopeStack.findLastIndex(
              (scope) => scope === selector || scope.startsWith(`${selector}.`),
            )
          : 0;
        if (depth < 0) continue;
        const rank = selector ? depth * 10000 + selector.length : -1;
        if (rule.settings.foreground && rank >= colorRank) {
          color = rule.settings.foreground;
          colorRank = rank;
        }
        if (rule.settings.fontStyle !== undefined && rank >= fontRank) {
          fontStyle = fontBits(rule.settings.fontStyle);
          fontRank = rank;
        }
      }
    }
    cached = { color, fontStyle };
    styles.set(key, cached);
    return cached;
  }
  return {
    getTheme,
    codeToHast(input: string, options: HighlightOptions): Root {
      const transformers = options.transformers ?? [];
      const context: Context = {
        addClassToHast(node, ...classes) {
          const existing = node.properties.class ?? node.properties.className;
          node.properties.class = [
            ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
            ...classes,
          ].join(" ");
          return node;
        },
      };
      let source = input.replace(/\r\n?/g, "\n");
      for (const transform of transformers)
        source = transform.preprocess?.call(context, source, options) ?? source;
      const result =
        options.lang === "text" || options.lang === "plaintext"
          ? undefined
          : dependencies.tokenize(source, options.lang);
      const spans: { start: number; end: number; kind: string }[] = [];
      let cursor = 0;
      if (result) {
        for (let index = 0; index < result.tokens.length; index += 3) {
          const kind = result.tokens[index];
          const start = result.tokens[index + 1];
          const end = result.tokens[index + 2];
          if (start < cursor || end < start || end > source.length)
            throw new Error("Invalid Twinkleplop token range");
          if (start > cursor) spans.push({ start: cursor, end: start, kind: "plain" });
          if (end > start) spans.push({ start, end, kind: result.token_types[kind] ?? "plain" });
          cursor = end;
        }
      }
      if (cursor < source.length) spans.push({ start: cursor, end: source.length, kind: "plain" });
      const selectedThemes = options.themes
        ? Object.entries(options.themes)
        : [["", options.theme ?? ""]];
      const makeToken = (content: string, offset: number, column: number, kind: string): Token => {
        const token: Token = { content, offset, __lineChar: column };
        token.htmlStyle = {};
        for (const [mode, name] of selectedThemes) {
          const style =
            kind === "plain" ? { color: getTheme(name).fg, fontStyle: 0 } : tokenStyle(name, kind);
          if (!mode) {
            token.color = style.color;
            token.fontStyle = style.fontStyle;
            token.htmlStyle.color = style.color;
            if (style.fontStyle) Object.assign(token.htmlStyle, fontCSS(style.fontStyle));
          } else {
            const prefix = `${options.cssVariablePrefix ?? "--shiki-"}${mode}`;
            token.htmlStyle[prefix] = style.color;
            if (style.fontStyle)
              for (const [property, value] of Object.entries(fontCSS(style.fontStyle)))
                token.htmlStyle[`${prefix}-${property}`] = value;
          }
        }
        return token;
      };
      let offset = 0;
      let spanIndex = 0;
      let lines = source.split("\n").map((line) => {
        const end = offset + line.length;
        const tokens: Token[] = [];
        // Parse the whole source first: a long line can change the grammar state
        // of the next line. Only its rendered tokens are reduced to plain text.
        if (options.tokenizeMaxLineLength && line.length > options.tokenizeMaxLineLength) {
          if (line.length) tokens.push(makeToken(line, offset, 0, "plain"));
        } else {
          while (spanIndex < spans.length && spans[spanIndex].end <= offset) spanIndex++;
          for (let index = spanIndex; index < spans.length && spans[index].start < end; index++) {
            const span = spans[index];
            const start = Math.max(offset, span.start);
            const stop = Math.min(end, span.end);
            const value = source.slice(start, stop);
            // Pierre requests unstyled edge whitespace for selectable tokens.
            const match =
              options.mergeWhitespaces === "never" && /^(\s*)(\S[\s\S]*?)(\s*)$/.exec(value);
            if (match && (match[1] || match[3])) {
              if (match[1]) tokens.push(makeToken(match[1], start, start - offset, "plain"));
              tokens.push(
                makeToken(
                  match[2],
                  start + match[1].length,
                  start + match[1].length - offset,
                  span.kind,
                ),
              );
              if (match[3])
                tokens.push(
                  makeToken(
                    match[3],
                    stop - match[3].length,
                    stop - match[3].length - offset,
                    "plain",
                  ),
                );
            } else tokens.push(makeToken(value, start, start - offset, span.kind));
          }
        }
        offset = end + 1;
        return tokens;
      });
      for (const transform of transformers) lines = transform.tokens?.call(context, lines) ?? lines;
      const decorations = new Map<number, Decoration[]>();
      for (const decoration of options.decorations ?? []) {
        for (
          let line = Math.max(0, decoration.start.line);
          line <= Math.min(lines.length - 1, decoration.end.line);
          line++
        ) {
          const items = decorations.get(line) ?? [];
          items.push(decoration);
          decorations.set(line, items);
        }
      }
      let code = element("code");
      for (const [lineIndex, tokens] of lines.entries()) {
        let line = element("span", [], { class: "line" });
        const marks = (decorations.get(lineIndex) ?? []).map((decoration) => ({
          start: decoration.start.line === lineIndex ? decoration.start.character : 0,
          end: decoration.end.line === lineIndex ? decoration.end.character : Infinity,
          properties: decoration.properties,
        }));
        for (const token of tokens) {
          const start = token.__lineChar;
          const end = start + token.content.length;
          const cuts = [
            ...new Set([
              start,
              end,
              ...marks
                .flatMap((mark) => [mark.start, mark.end])
                .filter((cut) => cut > start && cut < end),
            ]),
          ].sort((a, b) => a - b);
          for (let index = 0; index < cuts.length - 1; index++) {
            const from = cuts[index];
            const to = cuts[index + 1];
            let span = element(
              "span",
              [{ type: "text", value: token.content.slice(from - start, to - start) }],
              {
                ...token.htmlAttrs,
                style: Object.entries(token.htmlStyle ?? {})
                  .map(([property, value]) => `${property}:${value}`)
                  .join(";"),
              },
            );
            for (const transform of transformers)
              span = transform.span?.call(context, span, lineIndex + 1, from, line, token) ?? span;
            for (const mark of marks)
              if (from >= mark.start && to <= mark.end)
                span = element("span", [span], mark.properties);
            line.children.push(span);
          }
        }
        for (const transform of transformers)
          line = transform.line?.call(context, line, lineIndex + 1) ?? line;
        code.children.push(line);
      }
      for (const transform of transformers) code = transform.code?.call(context, code) ?? code;
      let pre = element("pre", [code]);
      for (const transform of transformers) pre = transform.pre?.call(context, pre) ?? pre;
      let root: Root = { type: "root", children: [pre] };
      for (const transform of transformers) root = transform.root?.call(context, root) ?? root;
      return root;
    },
  };
}
