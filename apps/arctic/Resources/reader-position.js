// Reader-only checkpoints. Anchor to a text block; percentage is a fallback
// when a refreshed extraction no longer contains that passage.
(() => {
  const blocks = () => [...document.querySelectorAll('main h1, main h2, main h3, main p, main li, main pre')];
  const text = node => node.textContent.trim().replace(/\s+/g, ' ').slice(0, 180);
  const limit = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
  globalThis.arcticPosition = {
    capture(top) {
      const nodes = blocks();
      const index = nodes.findIndex(node => node.getBoundingClientRect().bottom > top + 1);
      const node = nodes[index], rect = node?.getBoundingClientRect();
      return JSON.stringify({ index, anchor: node ? text(node) : '',
        fraction: rect ? (top - rect.top) / Math.max(1, rect.height) : 0,
        progress: Math.max(0, Math.min(1, scrollY / limit())) });
    },
    restore(position, top) {
      const nodes = blocks();
      let node = nodes[position.index];
      if (!node || text(node) !== position.anchor) node = nodes.find(n => text(n) === position.anchor);
      const rect = node?.getBoundingClientRect();
      const y = rect ? scrollY + rect.top + position.fraction * rect.height - top
        : position.progress * limit();
      // WebKit accounts for native toolbar insets. A manual DOM-height clamp
      // would stop above the saved passage near the end of the article.
      scrollTo(0, y);
    }
  };
})();
