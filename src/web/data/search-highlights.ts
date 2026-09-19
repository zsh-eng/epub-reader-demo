const MAX_MATCHES = 1000;

/** Highlight mounted text ranges without rewriting Pierre's syntax-token DOM. */
export function createSearchHighlights(name: string) {
  let host: HTMLElement | undefined;
  const clear = () => {
    if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete(name);
  };
  const refresh = (query: string) => {
    clear();
    if (!host || !query.trim() || typeof Highlight === "undefined" || !CSS.highlights) return;
    const root = host.shadowRoot ?? host;
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    const ranges: Range[] = [];
    for (const row of root.querySelectorAll<HTMLElement>("[data-line]")) {
      // These are only the virtualizer's mounted lines, never the whole file.
      const text = row.textContent ?? "";
      pattern.lastIndex = 0;
      const matches = text.matchAll(pattern);
      const nodes: { node: Text; start: number; end: number }[] = [];
      const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let offset = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        nodes.push({ node, start: offset, end: offset + node.length });
        offset += node.length;
      }
      let cursor = 0;
      for (const match of matches) {
        const start = match.index;
        const end = start + match[0].length;
        while (cursor < nodes.length && nodes[cursor]!.end <= start) cursor++;
        let last = cursor;
        while (last < nodes.length && nodes[last]!.end < end) last++;
        const firstNode = nodes[cursor];
        const lastNode = nodes[last];
        if (!firstNode || !lastNode) continue;
        const range = row.ownerDocument.createRange();
        range.setStart(firstNode.node, start - firstNode.start);
        range.setEnd(lastNode.node, end - lastNode.start);
        ranges.push(range);
        if (ranges.length === MAX_MATCHES) break;
      }
      if (ranges.length === MAX_MATCHES) break;
    }
    if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
  };
  return {
    refresh,
    update(node: HTMLElement, query: string) {
      host = node;
      refresh(query);
    },
    dispose() {
      host = undefined;
      clear();
    },
  };
}
