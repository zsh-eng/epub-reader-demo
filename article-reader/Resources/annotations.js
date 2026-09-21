// This API runs only in WebKit's app-owned content world on the cleaned Reader.
// Quotes use DOM text (UTF-16) so native selection and cached HTML share offsets.
(() => {
  const root = document.getElementById('reader-content');
  if (!root || globalThis.arcticAnnotations) return;
  const colours = ['yellow', 'sage', 'rose', 'blue'];
  const style = document.createElement('style');
  style.textContent = `
    :root { --annotation-yellow: rgba(245,199,64,.38); --annotation-sage: rgba(75,171,111,.24);
      --annotation-rose: rgba(229,104,140,.24); --annotation-blue: rgba(56,164,209,.24); }
    :root[data-theme="Ink"], :root[data-theme="Night"] {
      --annotation-yellow: rgba(245,199,64,.30); --annotation-sage: rgba(99,200,134,.30);
      --annotation-rose: rgba(241,137,166,.30); --annotation-blue: rgba(102,197,234,.30); }
    ${colours.map(colour => `::highlight(arctic-${colour}) {
      background-color: var(--annotation-${colour}); color: inherit;
    } mark[data-arctic-highlight="${colour}"] {
      background: var(--annotation-${colour}); color: inherit;
    }`).join('\n')}
  `;
  document.head.append(style);
  let resolved = new Map(), hitRanges = [], documentToken = '', picked = false;
  const colourOf = record => colours.includes(record.colour) ? record.colour : 'yellow';
  function notify(id = '') {
    if (!id && !picked) return;
    picked = Boolean(id);
    globalThis.webkit?.messageHandlers?.arcticAnnotationTap?.postMessage({ id, token: documentToken });
  }
  // CSS highlights have no DOM element. Hit-test the cached ranges only on tap,
  // never on scroll or in the rendering loop. Last-painted overlap wins.
  root.addEventListener('click', event => {
    if (!window.getSelection()?.isCollapsed) return;
    for (const { id, range } of [...hitRanges].reverse()) {
      if ([...range.getClientRects()].some(rect => event.clientX >= rect.left
          && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)) {
        event.preventDefault();
        notify(id);
        return;
      }
    }
    notify();
  });
  document.addEventListener('click', event => { if (!root.contains(event.target)) notify(); });
  window.addEventListener('scroll', () => notify(), { passive: true });
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
    // Partition each text node at every boundary. Later records win overlaps,
    // and adjacent runs of the same colour merge without nested DOM wrappers.
    for (const item of nodes) {
      const pieces = intervals.map(([start, end, colour]) => [
        Math.max(0, start - item.start), Math.min(item.node.length, end - item.start), colour
      ]).filter(([start, end]) => end > start);
      const boundaries = [...new Set(pieces.flatMap(([start, end]) => [start, end]))].sort((a, b) => a - b);
      const merged = [];
      for (let i = 0; i + 1 < boundaries.length; i++) {
        const start = boundaries[i], end = boundaries[i + 1];
        const owner = [...pieces].reverse().find(piece => piece[0] <= start && piece[1] >= end);
        if (!owner) continue;
        const previous = merged[merged.length - 1];
        if (previous && previous[1] === start && previous[2] === owner[2]) previous[1] = end;
        else merged.push([start, end, owner[2]]);
      }
      for (const [start, end, colour] of merged.reverse()) {
        const selected = item.node.splitText(start);
        selected.splitText(end - start);
        const mark = document.createElement('mark');
        mark.dataset.arcticHighlight = colour;
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
    render(records, token = '') {
      documentToken = token;
      // Empty replacement Highlight objects can leave old pixels painted in
      // WebKit even when their registry size is zero. Invalidate the old ranges
      // and remove their entries before resolving and registering the new ones.
      for (const colour of colours) {
        const name = 'arctic-' + colour;
        globalThis.CSS?.highlights?.get(name)?.clear();
        globalThis.CSS?.highlights?.delete(name);
      }
      unwrap();
      const { nodes, text } = content();
      const ranges = new Map(colours.map(colour => [colour, []])), intervals = [], missing = [];
      hitRanges = [];
      resolved = new Map();
      for (const record of records) {
        const start = locate(text, record.quote);
        const range = start < 0 ? null : rangeAt(nodes, start, start + record.quote.exact.length);
        if (!range) { missing.push(record.id); continue; }
        resolved.set(record.id, record.quote);
        hitRanges.push({ id: record.id, range });
        if (record.isHighlighted) {
          const colour = colourOf(record);
          ranges.get(colour).push(range);
          intervals.push([start, start + record.quote.exact.length, colour]);
        }
      }
      if (globalThis.CSS?.highlights && globalThis.Highlight) {
        for (const colour of colours) {
          const painted = ranges.get(colour);
          if (painted.length) CSS.highlights.set('arctic-' + colour, new Highlight(...painted));
        }
      } else {
        fallbackMark(nodes, intervals);
        // splitText moves live Range boundaries: rebuild after fallback wrapping.
        const rebuilt = content();
        hitRanges = [...resolved].flatMap(([id, quote]) => {
          const start = locate(rebuilt.text, quote);
          const range = start < 0 ? null : rangeAt(rebuilt.nodes, start, start + quote.exact.length);
          return range ? [{ id, range }] : [];
        });
      }
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
