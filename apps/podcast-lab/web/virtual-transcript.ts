/** Variable-height paragraphs, measured only near the viewport. Preserve the
 * first visible paragraph when measurements above it change, so reflow does
 * not pull the reader away from their place. No layout reads on playback ticks. */
export class VirtualTranscript {
  readonly nodes = new Map<number, HTMLElement>();
  private heights: number[] = [];
  private offsets: number[] = [];
  private width = 0;
  private observer: ResizeObserver;
  private containerObserver: ResizeObserver;
  private frame = 0;
  private target: { index: number; part: number; offset?: number } | undefined;

  constructor(
    private viewport: HTMLElement,
    private space: HTMLElement,
    private texts: string[],
    private create: (index: number) => HTMLElement,
    private decorate: () => void,
  ) {
    this.observer = new ResizeObserver((entries) => {
      const anchor = this.indexAt(this.viewport.scrollTop);
      const previousTop = this.offsets[anchor] ?? 0;
      let changed = false;
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.index);
        if (this.nodes.get(index) !== entry.target) continue;
        const height =
          entry.borderBoxSize[0]?.blockSize ??
          entry.target.getBoundingClientRect().height;
        if (Math.abs(this.heights[index] - height) < 0.5) continue;
        this.heights[index] = height;
        changed = true;
      }
      if (!changed) return;
      this.reflow();
      if (!this.target)
        this.viewport.scrollTop += this.offsets[anchor] - previousTop;
      this.render();
      this.alignTarget();
    });
    this.containerObserver = new ResizeObserver(() => this.resize());
    this.viewport.addEventListener("scroll", this.onScroll, { passive: true });
    this.containerObserver.observe(viewport);
    this.resize();
  }

  private onScroll = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  };

  private indexAt(offset: number) {
    let lo = 0,
      hi = this.texts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.offsets[mid] <= offset) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  }

  private resize() {
    const width = this.viewport.clientWidth;
    if (!width) return;
    if (width !== this.width) {
      const anchor = this.indexAt(this.viewport.scrollTop);
      const within = this.viewport.scrollTop - (this.offsets[anchor] ?? 0);
      this.width = width;
      // Estimates are replaced with actual border-box sizes before scrolling.
      const charsPerLine = Math.max(20, (width - 68) / 8.5);
      this.heights = this.texts.map(
        (text) => 58 + Math.ceil(text.length / charsPerLine) * 30,
      );
      for (const node of this.nodes.values()) {
        this.observer.unobserve(node);
        node.remove();
      }
      this.nodes.clear();
      this.reflow();
      this.viewport.scrollTop = this.offsets[anchor] + within;
    } else this.reflow();
    this.render();
    this.alignTarget();
  }

  private reflow() {
    let top = 0;
    this.offsets = this.heights.map((height) => {
      const start = top;
      top += height;
      return start;
    });
    this.space.style.height = `${top + this.viewport.clientHeight * 0.6}px`;
    for (const [index, node] of this.nodes)
      node.style.top = `${this.offsets[index]}px`;
  }

  private render() {
    if (!this.viewport.clientHeight) return;
    const first = this.indexAt(Math.max(0, this.viewport.scrollTop - 350));
    const last = Math.min(
      this.texts.length,
      this.indexAt(this.viewport.scrollTop + this.viewport.clientHeight + 350) +
        1,
    );
    for (const [index, node] of this.nodes) {
      if (
        (index >= first && index < last) ||
        node.contains(document.activeElement)
      )
        continue;
      this.observer.unobserve(node);
      node.remove();
      this.nodes.delete(index);
    }
    for (let index = first; index < last; index++) {
      if (this.nodes.has(index)) continue;
      const node = this.create(index);
      node.style.top = `${this.offsets[index]}px`;
      this.nodes.set(index, node);
      // Keep keyboard and screen-reader order aligned with visual order,
      // including when rows are mounted while scrolling upward.
      const nextIndex = [...this.nodes.keys()]
        .filter((candidate) => candidate > index)
        .sort((a, b) => a - b)[0];
      this.space.insertBefore(node, this.nodes.get(nextIndex) ?? null);
      this.observer.observe(node);
    }
    this.decorate();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.containerObserver.disconnect();
    this.viewport.removeEventListener("scroll", this.onScroll);
    this.nodes.clear();
    this.space.replaceChildren();
    this.space.style.height = "";
  }

  cancelFollow() {
    this.target = undefined;
  }

  restoreAnchor(index: number, offset: number) {
    this.target = { index, part: -1, offset };
    this.viewport.scrollTop = Math.max(0, this.offsets[index] - offset);
    this.render();
    this.alignTarget();
  }

  /** Resolve estimated offsets first, then anchor to the measured sentence.
   * Reapply after ResizeObserver measurements; smooth scrolling toward a stale
   * estimate can otherwise stop on an unrelated paragraph. */
  scrollTo(index: number, part: number, force = true) {
    this.target = { index, part };
    if (!this.viewport.clientHeight) return;
    const rect = this.targetRect();
    const viewport = this.viewport.getBoundingClientRect();
    if (
      !force &&
      rect &&
      rect.top >= viewport.top + 25 &&
      rect.bottom <= viewport.bottom - 85
    )
      return;
    if (!rect) {
      this.viewport.scrollTo({
        top: Math.max(
          0,
          this.offsets[index] - this.viewport.clientHeight * 0.25,
        ),
        behavior: "instant",
      });
      this.render();
    }
    this.alignTarget();
  }

  private targetRect() {
    if (!this.target) return;
    const node = this.nodes.get(this.target.index);
    const sentence = node?.querySelectorAll(".sentence")[this.target.part];
    return sentence?.getClientRects()[0] ?? node?.getBoundingClientRect();
  }

  private alignTarget() {
    const rect = this.targetRect();
    if (!rect) return;
    const viewport = this.viewport.getBoundingClientRect();
    const delta =
      rect.top - viewport.top - (this.target?.offset ?? viewport.height * 0.25);
    if (Math.abs(delta) < 1) return;
    this.viewport.scrollTo({
      top: Math.max(0, this.viewport.scrollTop + delta),
      behavior: "instant",
    });
    this.render();
  }
}
