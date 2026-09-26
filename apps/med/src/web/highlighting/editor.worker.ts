import { createHighlighter } from "./runtime";
import type { AdapterTheme } from "./adapter";
const highlighter = await createHighlighter();
let latest: { id: number; text: string; language: string; theme: AdapterTheme } | undefined;
let running = false;
self.onmessage = (event: MessageEvent<NonNullable<typeof latest>>) => {
  latest = event.data;
  if (!running) void drain();
};
async function drain() {
  running = true;
  while (latest) {
    const task = latest;
    latest = undefined;
    try {
      highlighter.loadThemeSync(task.theme);
      await highlighter.prepareSource(task.language, task.text);
      // An in-flight grammar load can be overtaken by newer input.
      if (latest) continue;
      const styles: string[] = [];
      const indices = new Map<string, number>();
      const ranges: number[] = [];
      for (const line of highlighter.codeToTokens(task.text, {
        lang: task.language,
        theme: task.theme.name!,
        tokenizeMaxLineLength: 20000,
      })) {
        for (const token of line) {
          if (!token.content.length) continue;
          const style = Object.entries(token.htmlStyle ?? {})
            .map(([key, value]) => `${key}:${value}`)
            .join(";");
          let index = indices.get(style);
          if (index === undefined) {
            index = styles.length;
            styles.push(style);
            indices.set(style, index);
          }
          ranges.push(token.offset, token.offset + token.content.length, index);
        }
      }
      const packed = Uint32Array.from(ranges);
      self.postMessage({ id: task.id, styles, ranges: packed }, [packed.buffer]);
    } catch (error) {
      self.postMessage({
        id: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  running = false;
}
