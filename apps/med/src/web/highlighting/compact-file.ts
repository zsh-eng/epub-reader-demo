import type { Element, ElementContent } from "hast";
import type { HighlightOptions, StyledToken } from "./adapter";

/** A full lexical pass with no offscreen render nodes. Only file results use this format. */
export interface CompactFile {
  kind: "med-file-tokens-v1";
  styles: string[];
  // Each line alternates a style-table index and source text.
  lines: (number | string)[][];
  useTokenTransformer: boolean;
  themeStyles: string;
  baseThemeType?: "light" | "dark";
}

export function compactFile(
  source: string,
  highlighter: { codeToTokens(source: string, options: HighlightOptions): StyledToken[][] },
  options: HighlightOptions,
  metadata: Pick<CompactFile, "themeStyles" | "baseThemeType" | "useTokenTransformer">,
): CompactFile {
  const styles: string[] = [];
  const styleIndices = new Map<string, number>();
  const lines = highlighter
    .codeToTokens(source, {
      ...options,
      ...(metadata.useTokenTransformer ? { mergeWhitespaces: "never" } : {}),
    })
    .map((tokens) => {
      const line: (number | string)[] = [];
      for (const token of tokens) {
        if (!token.content.length) continue;
        const style = Object.entries(token.htmlStyle ?? {})
          .map(([property, value]) => `${property}:${value}`)
          .join(";");
        let index = styleIndices.get(style);
        if (index === undefined) {
          index = styles.length;
          styles.push(style);
          styleIndices.set(style, index);
        }
        line.push(index, token.content);
      }
      return line;
    });
  return { kind: "med-file-tokens-v1", styles, lines, ...metadata };
}

/** Restore Pierre's array contract, but construct a line only when it is used. */
export function expandCompactFile(packet: CompactFile) {
  if (packet.kind !== "med-file-tokens-v1") throw new Error("Unsupported med file token format");
  const code: Element[] = new Array(packet.lines.length);
  for (let index = 0; index < code.length; index++) {
    const store = (value: Element) => {
      Object.defineProperty(code, index, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    };
    Object.defineProperty(code, index, {
      enumerable: true,
      configurable: true,
      set: store,
      get() {
        const tokens = packet.lines[index];
        const children: ElementContent[] = [];
        let column = 0;
        for (let position = 0; position < tokens.length; position += 2) {
          const value = tokens[position + 1] as string;
          children.push({
            type: "element",
            tagName: "span",
            properties: {
              style: packet.styles[tokens[position] as number],
              ...(packet.useTokenTransformer ? { "data-char": column } : {}),
            },
            children: [{ type: "text", value }],
          });
          column += value.length;
        }
        if (!children.length)
          children.push(
            packet.useTokenTransformer
              ? { type: "element", tagName: "br", properties: {}, children: [] }
              : { type: "text", value: "\n" },
          );
        const line: Element = {
          type: "element",
          tagName: "div",
          properties: {
            "data-line": index + 1,
            "data-line-type": "context",
            "data-line-index": index,
          },
          children,
        };
        store(line);
        return line;
      },
    });
  }
  return { code, themeStyles: packet.themeStyles, baseThemeType: packet.baseThemeType };
}
