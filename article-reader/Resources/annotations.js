// This API runs only in WebKit's app-owned content world on the cleaned Reader.
// Quotes use DOM text (UTF-16) so native selection and cached HTML share offsets.
(() => {
  const root = document.getElementById('reader-content');
  if (!root || globalThis.arcticAnnotations) return;
  const style = document.createElement('style');
  style.textContent = `
    ::highlight(arctic-preserved) { background-color: var(--annotation-fill); color: inherit; }
    mark[data-arctic-highlight] { background: var(--annotation-fill); color: inherit; }
  `;
  document.head.append(style);
  let resolved = new Map();
  function content() {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '', node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: text.length });
      text += node.textContent;
    }
    return { nodes, text };
  }
  function rangeAt(nodes, start, end) {
    const first = nodes.find(item => item.start + item.node.length > start);
    const last = nodes.find(item => item.start + item.node.length >= end);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  }
  function locate(text, quote) {
    if (!quote.exact) return -1;
    const matchesContext = i => (!quote.prefix || text.slice(0, i).endsWith(quote.prefix))
      && (!quote.suffix || text.slice(i + quote.exact.length).startsWith(quote.suffix));
    if (text.slice(quote.start, quote.start + quote.exact.length) === quote.exact
        && matchesContext(quote.start)) return quote.start;
    const matches = [];
    let i = text.indexOf(quote.exact);
    while (i >= 0) {
      matches.push(i);
      i = text.indexOf(quote.exact, i + 1);
    }
    const contextual = matches.filter(matchesContext);
    if (contextual.length === 1) return contextual[0];
    // A unique quote remains safe after nearby prose changes. Ambiguous quotes
    // stay in Notes, rather than silently jumping to a different occurrence.
    return matches.length === 1 ? matches[0] : -1;
  }
  function unwrap() {
    for (const mark of root.querySelectorAll('mark[data-arctic-highlight]')) {
      mark.replaceWith(...mark.childNodes);
    }
    root.normalize();
  }
  function fallbackMark(nodes, intervals) {
    // Build disjoint intervals for each text node. This also handles overlapping
    // highlights without nested marks or changing the article's text content.
    for (const item of nodes) {
      const pieces = intervals.map(([start, end]) => [
        Math.max(0, start - item.start), Math.min(item.node.length, end - item.start)
      ]).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const piece of pieces) {
        const previous = merged[merged.length - 1];
        if (previous && piece[0] <= previous[1]) previous[1] = Math.max(previous[1], piece[1]);
        else merged.push(piece);
      }
      for (const [start, end] of merged.reverse()) {
        const selected = item.node.splitText(start);
        selected.splitText(end - start);
        const mark = document.createElement('mark');
        mark.dataset.arcticHighlight = '';
        selected.replaceWith(mark);
        mark.append(selected);
      }
    }
  }
  globalThis.arcticAnnotations = {
    selection() {
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
      const before = document.createRange();
      before.selectNodeContents(root);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      const exact = range.toString();
      if (!exact.trim()) return null;
      const { text } = content();
      return { exact, start, prefix: text.slice(Math.max(0, start - 48), start),
        suffix: text.slice(start + exact.length, start + exact.length + 48) };
    },
    render(records) {
      unwrap();
      const { nodes, text } = content();
      const ranges = [], intervals = [], missing = [];
      resolved = new Map();
      for (const record of records) {
        const start = locate(text, record.quote);
        const range = start < 0 ? null : rangeAt(nodes, start, start + record.quote.exact.length);
        if (!range) { missing.push(record.id); continue; }
        resolved.set(record.id, record.quote);
        if (record.isHighlighted) { ranges.push(range); intervals.push([start, start + record.quote.exact.length]); }
      }
      if (globalThis.CSS?.highlights && globalThis.Highlight) {
        CSS.highlights.set('arctic-preserved', new Highlight(...ranges));
      } else { fallbackMark(nodes, intervals); }
      return missing;
    },
    reveal(id) {
      const quote = resolved.get(id);
      if (!quote) return false;
      const { nodes, text } = content();
      const start = locate(text, quote);
      const range = start < 0 ? null : rangeAt(nodes, start, start + quote.exact.length);
      if (!range) return false;
      const top = window.scrollY + range.getBoundingClientRect().top - window.innerHeight * 0.3;
      window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      return true;
    }
  };
})();
