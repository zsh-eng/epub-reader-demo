// Native controls follow completed selection, not each selectionchange event.
(() => {
  const send = value => window.webkit?.messageHandlers?.arcticMac?.postMessage(value);
  let selectionFrame = 0;
  document.addEventListener('selectionchange', () => {
    if (selectionFrame) return;
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = 0;
      if (!globalThis.CSS?.highlights || !globalThis.Highlight) return;
      CSS.highlights.delete('arctic-selection');
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (document.getElementById('reader-content')?.contains(range.commonAncestorContainer)) {
        CSS.highlights.set('arctic-selection', new Highlight(range.cloneRange()));
      }
    });
  });
  document.addEventListener('mouseup', event => {
    const selection = window.getSelection();
    const root = document.getElementById('reader-content');
    if (!root?.contains(event.target) || !selection?.rangeCount || selection.isCollapsed) { send({ dismissSelection: true }); return; }
    const range = selection.getRangeAt(0);
    if (!root?.contains(range.commonAncestorContainer)) return;
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight);
    const rect = rects.at(-1);
    if (rect) send({ selection: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') send({ dismissSelection: true }); });
  window.addEventListener('scroll', () => send({ dismissSelection: true }), { passive: true });
})();
