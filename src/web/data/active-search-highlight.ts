import type { VimNavigation } from "./vim-navigation";

/** One range at the cursor; no full-file scan or React update on movement. */
export function createActiveSearchHighlight(name: string) {
  const clear = () => {
    CSS.highlights?.delete(name);
  };
  return {
    update(host: HTMLElement | null, model: VimNavigation, visible: boolean) {
      clear();
      if (!visible || !host || !model.query || typeof Highlight === "undefined") return;
      // The search worker returns sorted offsets. Find the match under the cursor.
      let low = 0;
      let high = model.matches.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (model.matches[mid]! <= model.offset) low = mid + 1;
        else high = mid;
      }
      const start = model.matches[low - 1];
      if (start === undefined || model.offset >= start + model.query.length) return;
      const row = host.shadowRoot?.querySelector(`[data-line="${model.line + 1}"]`);
      if (!row) return;
      const from = start - model.starts[model.line]!;
      const to = from + model.query.length;
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let offset = 0;
      let started = false;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (!started && offset + node.length > from) {
          range.setStart(node, from - offset);
          started = true;
        }
        if (started && offset + node.length >= to) {
          range.setEnd(node, to - offset);
          const highlight = new Highlight(range);
          highlight.priority = 2;
          CSS.highlights?.set(name, highlight);
          return;
        }
        offset += node.length;
      }
    },
    dispose: clear,
  };
}
