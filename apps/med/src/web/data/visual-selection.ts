import type { VimNavigation } from "./vim-navigation";

/** CSS ranges follow horizontal scroll without overlays or token DOM edits.
 * Only mounted rows are visited; the model remains the source for copying. */
export function createVisualSelection(name: string) {
  let host: HTMLElement | null = null;
  const marked = new Set<HTMLElement>();
  const clear = () => {
    if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete(name);
    for (const row of marked) {
      delete row.dataset.vimVisualLine;
      delete row.dataset.vimVisualEmpty;
    }
    marked.clear();
  };
  return {
    update(node: HTMLElement | null, model: VimNavigation, enabled: boolean) {
      host = node;
      clear();
      const selection = enabled ? model.visualRange : null;
      if (!selection || !host) return;
      const ranges: Range[] = [];
      for (const row of (host.shadowRoot ?? host).querySelectorAll<HTMLElement>("[data-line]")) {
        const line = Number(row.dataset.line) - 1;
        if (line < selection.startLine || line > selection.endLine) continue;
        if (selection.mode === "line") {
          row.dataset.vimVisualLine = "";
          marked.add(row);
          continue;
        }
        const text = model.lines[line];
        if (text === undefined) continue;
        if (!text.length) {
          row.dataset.vimVisualEmpty = "";
          marked.add(row);
          continue;
        }
        const start = Math.max(0, selection.start - model.starts[line]!);
        const end = Math.min(text.length, selection.end - model.starts[line]!);
        if (end <= start) continue;
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let offset = 0,
          started = false;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          if (!started && offset + node.length > start) {
            range.setStart(node, start - offset);
            started = true;
          }
          if (started && offset + node.length >= end) {
            range.setEnd(node, end - offset);
            ranges.push(range);
            break;
          }
          offset += node.length;
        }
      }
      if (ranges.length && typeof Highlight !== "undefined" && CSS.highlights) {
        const highlight = new Highlight(...ranges);
        highlight.priority = 1;
        CSS.highlights.set(name, highlight);
      }
    },
    dispose() {
      clear();
      host = null;
    },
  };
}
