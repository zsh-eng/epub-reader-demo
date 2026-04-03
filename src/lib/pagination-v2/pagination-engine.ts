import { layoutPages } from "../pagination/layout-pages";
import { prepareBlocks } from "../pagination/prepare-blocks";
import type {
  Block,
  Page,
  PaginationChapterDiagnostics,
  PaginationConfig,
  PreparedBlock,
  TextCursorOffset,
} from "../pagination/types";
import { areFontConfigsEqual } from "../pagination/types";
import type {
  ChapterUnavailableEvent,
  PaginationCommand,
  PaginationEvent,
} from "./engine-types";
import type { ContentAnchor, ResolvedPage } from "./types";

// ---------------------------------------------------------------------------
// Runtime interface (provided by the worker)
// ---------------------------------------------------------------------------

export interface PaginationRuntime {
  /** Called periodically during long relayouts. May yield to the event loop
   *  and drain pending navigation commands before returning. */
  maybeYield: () => Promise<void>;
  /** Returns true if this relayout should be abandoned (a newer one is pending). */
  isStale: () => boolean;
}

const DEFAULT_RUNTIME: PaginationRuntime = {
  maybeYield: async () => {},
  isStale: () => false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function compareOffsets(a: TextCursorOffset, b: TextCursorOffset): number {
  if (a.itemIndex !== b.itemIndex) return a.itemIndex < b.itemIndex ? -1 : 1;
  if (a.segmentIndex !== b.segmentIndex)
    return a.segmentIndex < b.segmentIndex ? -1 : 1;
  if (a.graphemeIndex !== b.graphemeIndex)
    return a.graphemeIndex < b.graphemeIndex ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------------------
// PaginationEngine
// ---------------------------------------------------------------------------

export class PaginationEngine {
  /** Set by the worker before each command so all emitted events carry the
   *  correct epoch for staleness filtering on the main thread. */
  epoch = 0;

  private emit: (event: PaginationEvent) => void;

  private config!: PaginationConfig;
  private totalChapters = 0;
  private initialChapterIndex = 0;

  private blocksByChapter: (Block[] | null)[] = [];
  private preparedByChapter: (PreparedBlock[] | null)[] = [];
  private pagesByChapter: (Page[] | null)[] = [];
  private chapterDiagnosticsByChapter: (PaginationChapterDiagnostics | null)[] =
    [];

  /** Always non-null after init(). Updated only by navigation commands. */
  private anchor!: ContentAnchor;

  constructor(emit: (event: PaginationEvent) => void) {
    this.emit = emit;
  }

  get receivedChapters(): number {
    return this.blocksByChapter.reduce((count, blocks) => count + (blocks === null ? 0 : 1), 0)
  }

  // -------------------------------------------------------------------------
  // Command dispatcher
  // -------------------------------------------------------------------------

  async handleCommand(
    cmd: PaginationCommand,
    runtime: Partial<PaginationRuntime> = {},
  ): Promise<void> {
    try {
      switch (cmd.type) {
        case "init":
          this.init(
            cmd.totalChapters,
            cmd.config,
            cmd.initialChapterIndex,
            cmd.initialAnchor,
            cmd.firstChapterBlocks,
          );
          break;
        case "addChapter":
          this.addChapter(cmd.chapterIndex, cmd.blocks);
          break;
        case "updateConfig":
          await this.updateConfig(cmd.config, runtime);
          break;
        case "nextPage":
          this.nextPage();
          break;
        case "prevPage":
          this.prevPage();
          break;
        case "goToPage":
          this.goToPage(cmd.page);
          break;
        case "goToChapter":
          this.goToChapter(cmd.chapterIndex);
          break;
      }
    } catch (err) {
      this.emit({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Command handlers
  // -------------------------------------------------------------------------

  init(
    totalChapters: number,
    config: PaginationConfig,
    initialChapterIndex: number,
    initialAnchor: ContentAnchor | undefined,
    firstChapterBlocks: Block[],
  ): void {
    this.config = config;
    this.totalChapters = Math.max(1, totalChapters);
    this.initialChapterIndex = clamp(
      initialChapterIndex,
      0,
      this.totalChapters - 1,
    );

    this.blocksByChapter = Array.from<Block[] | null>({ length: this.totalChapters}).fill(null);
    this.preparedByChapter = Array.from<PreparedBlock[] | null>({ length: this.totalChapters}).fill(null);
    this.pagesByChapter = Array.from<Page[] | null>({ length: this.totalChapters }).fill(null);
    this.chapterDiagnosticsByChapter = Array.from<PaginationChapterDiagnostics | null>({ length: this.totalChapters }).fill(null);

    this.blocksByChapter[this.initialChapterIndex] = firstChapterBlocks;

    const diagnostics = this.prepareAndLayoutChapter(this.initialChapterIndex);

    // Establish anchor — use initialAnchor if it resolves, else pick page 0.
    if (initialAnchor) {
      const resolved = this.resolveAnchorToPage(initialAnchor);
      this.anchor = resolved ? initialAnchor : this.pickAnchorForPage(this.initialChapterIndex, 0);
    } else {
      this.anchor = this.pickAnchorForPage(this.initialChapterIndex, 0);
    }

    const page = this.buildResolvedPage();
    if (!page) {
      this.emit({ type: "error", message: "Failed to build initial page after init" });
      return;
    }

    if (this.totalChapters === 1) {
      this.emit({
        type: "ready",
        epoch: this.epoch,
        page,
        chapterDiagnostics: diagnostics ? [diagnostics] : [],
      });
    } else {
      this.emit({
        type: "partialReady",
        epoch: this.epoch,
        page,

        chapterDiagnostics: diagnostics,
      });
    }
  }

  // TODO: I already said that multiple chapters to be added at the same time?
  addChapter(chapterIndex: number, blocks: Block[]): void {
    if (chapterIndex < 0 || chapterIndex >= this.totalChapters) {
      this.emit({
        type: "error",
        message: `addChapter: index ${chapterIndex} out of bounds`,
      });
      return;
    }

    // Skip if we already have this chapter (e.g. initialChapterIndex from init).
    if (this.blocksByChapter[chapterIndex] !== null) return;

    this.blocksByChapter[chapterIndex] = blocks;
    const diagnostics = this.prepareAndLayoutChapter(chapterIndex);

    const page = this.buildResolvedPage();
    if (!page) return;

    if (this.receivedChapters === this.totalChapters) {
      this.emit({
        type: "ready",
        epoch: this.epoch,
        page,
        chapterDiagnostics: this.chapterDiagnosticsByChapter.filter(
          (d): d is PaginationChapterDiagnostics => d !== null,
        ),
      });
    } else {
      this.emit({
        type: "progress",
        epoch: this.epoch,
        chaptersCompleted: this.receivedChapters,
        totalChapters: this.totalChapters,

        chapterDiagnostics: diagnostics,
      });
    }
  }

  async updateConfig(
    nextConfig: PaginationConfig,
    runtime: Partial<PaginationRuntime> = {},
  ): Promise<void> {
    if (this.areConfigsEqual(this.config, nextConfig)) {
      this.config = nextConfig;
      return;
    }

    const fontChanged = !areFontConfigsEqual(
      this.config.fontConfig,
      nextConfig.fontConfig,
    );
    this.config = nextConfig;

    if (this.receivedChapters === 0) return;

    const rt = this.resolveRuntime(runtime);

    if (fontChanged) {
      await this.runRelayout(
        (ch) => {
          if (!this.blocksByChapter[ch]) return null;
          return this.prepareAndLayoutChapter(ch);
        },
        rt,
      );
    } else {
      await this.runRelayout(
        (ch) => {
          const prepared = this.preparedByChapter[ch];
          if (!prepared) return null;
          const stage2PrepareMs =
            this.chapterDiagnosticsByChapter[ch]?.stage2PrepareMs ?? 0;
          return this.layoutPreparedChapter(ch, prepared, stage2PrepareMs);
        },
        rt,
      );
    }
  }

  nextPage(): void {
    const current = this.resolveAnchorToPage(this.anchor);
    if (!current) {
      this.emitPageUnavailable();
      return;
    }

    const { chapterIndex, localPageIndex } = current;
    const pages = this.pagesByChapter[chapterIndex];

    // Try next page within same chapter.
    if (pages && localPageIndex + 1 < pages.length) {
      this.anchor = this.pickAnchorForPage(chapterIndex, localPageIndex + 1);
      this.emitPageContent();
      return;
    }

    // Try first page of the next available chapter.
    for (let ch = chapterIndex + 1; ch < this.totalChapters; ch++) {
      const chPages = this.pagesByChapter[ch];
      if (chPages && chPages.length > 0) {
        this.anchor = this.pickAnchorForPage(ch, 0);
        this.emitPageContent();
        return;
      }
    }

    this.emitPageUnavailable();
  }

  prevPage(): void {
    const current = this.resolveAnchorToPage(this.anchor);
    if (!current) {
      this.emitPageUnavailable();
      return;
    }

    const { chapterIndex, localPageIndex } = current;

    // Try previous page within same chapter.
    if (localPageIndex > 0) {
      this.anchor = this.pickAnchorForPage(chapterIndex, localPageIndex - 1);
      this.emitPageContent();
      return;
    }

    // Try last page of the previous available chapter.
    for (let ch = chapterIndex - 1; ch >= 0; ch--) {
      const chPages = this.pagesByChapter[ch];
      if (chPages && chPages.length > 0) {
        this.anchor = this.pickAnchorForPage(ch, chPages.length - 1);
        this.emitPageContent();
        return;
      }
    }

    this.emitPageUnavailable();
  }

  goToPage(globalPage: number): void {
    const page1 = Math.max(1, Math.floor(globalPage));
    const pageIndex = page1 - 1;

    for (let ch = this.chapterPageOffsets.length - 1; ch >= 0; ch--) {
      const offset = this.chapterPageOffsets[ch];
      if (offset === undefined || pageIndex < offset) continue;

      const localIndex = pageIndex - offset;
      const pages = this.pagesByChapter[ch];
      if (!pages || localIndex >= pages.length) continue;

      this.anchor = this.pickAnchorForPage(ch, localIndex);
      this.emitPageContent();
      return;
    }

    this.emitPageUnavailable();
  }

  goToChapter(chapterIndex: number): void {
    const ch = Math.floor(chapterIndex);
    if (ch < 0 || ch >= this.totalChapters) {
      const event: ChapterUnavailableEvent = {
        type: "chapterUnavailable",
        epoch: this.epoch,
        chapterIndex: ch,
      };
      this.emit(event);
      return;
    }

    const pages = this.pagesByChapter[ch];
    if (!pages || pages.length === 0) {
      const event: ChapterUnavailableEvent = {
        type: "chapterUnavailable",
        epoch: this.epoch,
        chapterIndex: ch,
      };
      this.emit(event);
      return;
    }

    // TODO: for going to chapters and the initial chapter, ideally the anchor should
    // be on the start of the first page so we're always anchored to the start of the
    // chapter
    this.anchor = this.pickAnchorForPage(ch, 0);
    this.emitPageContent();
  }

  // -------------------------------------------------------------------------
  // Relayout
  // -------------------------------------------------------------------------

  private async runRelayout(
    relayoutChapter: (
      chapterIndex: number,
    ) => PaginationChapterDiagnostics | null,
    runtime: PaginationRuntime,
  ): Promise<void> {
    const order = this.buildMiddleOutOrder(this.anchor.chapterIndex);
    let emittedPartial = false;

    for (const ch of order) {
      if (runtime.isStale()) return;

      const diag = relayoutChapter(ch);
      if (!diag) continue;

      const page = this.buildResolvedPage();

      if (!emittedPartial && page) {
        this.emit({
          type: "partialReady",
          epoch: this.epoch,
          page,

          chapterDiagnostics: diag,
        });
        emittedPartial = true;
      } else {
        this.emit({
          type: "progress",
          epoch: this.epoch,
          chaptersCompleted: this.receivedChapters,
          totalChapters: this.totalChapters,

          chapterDiagnostics: diag,
        });
      }

      if (runtime.isStale()) return;
      await runtime.maybeYield();
    }

    if (runtime.isStale()) return;

    const page = this.buildResolvedPage();
    if (!page) return;

    this.emit({
      type: "ready",
      epoch: this.epoch,
      page,
      chapterDiagnostics: this.chapterDiagnosticsByChapter.filter(
        (d): d is PaginationChapterDiagnostics => d !== null,
      ),
    });
  }

  // -------------------------------------------------------------------------
  // Layout helpers
  // -------------------------------------------------------------------------

  private prepareAndLayoutChapter(
    chapterIndex: number,
  ): PaginationChapterDiagnostics | null {
    const blocks = this.blocksByChapter[chapterIndex];
    if (!blocks) return null;

    const stage2StartedAt = performance.now();
    const prepared = prepareBlocks(blocks, this.config.fontConfig);
    const stage2PrepareMs = performance.now() - stage2StartedAt;
    this.preparedByChapter[chapterIndex] = prepared;

    return this.layoutPreparedChapter(chapterIndex, prepared, stage2PrepareMs);
  }

  private layoutPreparedChapter(
    chapterIndex: number,
    prepared: PreparedBlock[],
    stage2PrepareMs: number,
  ): PaginationChapterDiagnostics {
    const { viewport, layoutTheme } = this.config;
    const result = layoutPages(
      prepared,
      viewport.width,
      viewport.height,
      layoutTheme,
    );
    this.pagesByChapter[chapterIndex] = result.pages;

    const diag: PaginationChapterDiagnostics = {
      chapterIndex,
      blockCount: result.diagnostics.blockCount,
      lineCount: result.diagnostics.lineCount,
      pageCount: result.pages.length,
      stage2PrepareMs,
      stage3LayoutMs: result.diagnostics.computeMs,
      totalMs: stage2PrepareMs + result.diagnostics.computeMs,
    };
    this.chapterDiagnosticsByChapter[chapterIndex] = diag;
    return diag;
  }

  // -------------------------------------------------------------------------
  // Computed properties
  // -------------------------------------------------------------------------

  private get chapterPageOffsets(): number[] {
    const offsets: number[] = [];
    let running = 0;
    for (let i = 0; i < this.totalChapters; i++) {
      offsets[i] = running;
      running += this.pagesByChapter[i]?.length ?? 0;
    }
    return offsets;
  }

  private get totalPages(): number {
    let total = 0;
    for (const pages of this.pagesByChapter) {
      total += pages?.length ?? 0;
    }
    return Math.max(1, total);
  }

  // -------------------------------------------------------------------------
  // Anchor / page resolution
  // -------------------------------------------------------------------------

  /** Returns the chapter + local page index for the given anchor, or null if
   *  the chapter has not been laid out yet. */
  private resolveAnchorToPage(
    anchor: ContentAnchor,
  ): { chapterIndex: number; localPageIndex: number } | null {
    const pages = this.pagesByChapter[anchor.chapterIndex];
    if (!pages) return null;

    const { blockId } = anchor;

    if (anchor.type === "block") {
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (!page) continue;
        for (const slice of page.slices) {
          if (slice.blockId === blockId) {
            return { chapterIndex: anchor.chapterIndex, localPageIndex: i };
          }
        }
      }
      // Block not found — fall back to chapter start.
      return { chapterIndex: anchor.chapterIndex, localPageIndex: 0 };
    }

    // "text" anchor — find page whose line range contains the offset.
    const { offset: anchorOffset } = anchor;
    let firstBlockPage: number | null = null;
    let nearestPrecedingPage: number | null = null;
    let nearestPrecedingEnd: TextCursorOffset | null = null;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) continue;
      for (const slice of page.slices) {
        if (slice.blockId !== blockId) continue;
        if (firstBlockPage === null) firstBlockPage = i;

        if (slice.type !== "text") continue;
        for (const line of slice.lines) {
          const { startOffset, endOffset } = line;
          if (!startOffset || !endOffset) continue;

          const startCmp = compareOffsets(startOffset, anchorOffset);
          const endCmp = compareOffsets(anchorOffset, endOffset);
          if (startCmp <= 0 && endCmp < 0) {
            return { chapterIndex: anchor.chapterIndex, localPageIndex: i };
          }

          if (compareOffsets(endOffset, anchorOffset) <= 0) {
            if (
              !nearestPrecedingEnd ||
              compareOffsets(endOffset, nearestPrecedingEnd) > 0
            ) {
              nearestPrecedingEnd = endOffset;
              nearestPrecedingPage = i;
            }
          }
        }
      }
    }

    if (nearestPrecedingPage !== null) {
      return { chapterIndex: anchor.chapterIndex, localPageIndex: nearestPrecedingPage };
    }
    if (firstBlockPage !== null) {
      return { chapterIndex: anchor.chapterIndex, localPageIndex: firstBlockPage };
    }
    // Block not found — fall back to chapter start.
    return { chapterIndex: anchor.chapterIndex, localPageIndex: 0 };
  }

  /** Pick an anchor from the middle of a page (stable choice across reflows). */
  private pickAnchorForPage(
    chapterIndex: number,
    localPageIndex: number,
  ): ContentAnchor {
    const pages = this.pagesByChapter[chapterIndex];
    const page = pages?.[localPageIndex];

    if (!page || page.slices.length === 0) {
      // Degenerate: return a block anchor at chapter start (will resolve later).
      return { type: "block", chapterIndex, blockId: "" };
    }

    const midSlice = page.slices[Math.floor(page.slices.length / 2)];
    if (!midSlice) {
      return { type: "block", chapterIndex, blockId: page.slices[0]!.blockId };
    }

    if (midSlice.type !== "text") {
      return { type: "block", chapterIndex, blockId: midSlice.blockId };
    }

    const midLine = midSlice.lines[Math.floor(midSlice.lines.length / 2)];
    if (midLine?.startOffset) {
      return {
        type: "text",
        chapterIndex,
        blockId: midSlice.blockId,
        offset: { ...midLine.startOffset },
      };
    }

    return { type: "block", chapterIndex, blockId: midSlice.blockId };
  }

  /** Build a ResolvedPage from the current anchor. Returns null only if the
   *  anchor's chapter hasn't been laid out yet (shouldn't happen after init). */
  private buildResolvedPage(): ResolvedPage | null {
    const resolved = this.resolveAnchorToPage(this.anchor);
    if (!resolved) return null;

    const { chapterIndex, localPageIndex } = resolved;
    const pages = this.pagesByChapter[chapterIndex];
    if (!pages) return null;

    const page = pages[localPageIndex];
    const offset = this.chapterPageOffsets[chapterIndex] ?? 0;

    return {
      currentPage: offset + localPageIndex + 1,
      totalPages: this.totalPages,
      currentPageInChapter: localPageIndex + 1,
      totalPagesInChapter: pages.length,
      chapterIndex,
      content: page?.slices ?? [],
    };
  }

  // -------------------------------------------------------------------------
  // Emit helpers
  // -------------------------------------------------------------------------

  private emitPageContent(): void {
    const page = this.buildResolvedPage();
    if (!page) {
      this.emitPageUnavailable();
      return;
    }
    this.emit({ type: "pageContent", epoch: this.epoch, page });
  }

  private emitPageUnavailable(): void {
    this.emit({ type: "pageUnavailable", epoch: this.epoch });
  }

  // -------------------------------------------------------------------------
  // Middle-out chapter order
  // -------------------------------------------------------------------------

  private buildMiddleOutOrder(centerChapter: number): number[] {
    if (this.totalChapters <= 0) return [];
    const center = clamp(centerChapter, 0, this.totalChapters - 1);
    const order: number[] = [center];

    for (let delta = 1; order.length < this.totalChapters; delta++) {
      const right = center + delta;
      if (right < this.totalChapters) order.push(right);
      const left = center - delta;
      if (left >= 0) order.push(left);
    }

    return order;
  }

  // -------------------------------------------------------------------------
  // Config equality
  // -------------------------------------------------------------------------

  private areConfigsEqual(a: PaginationConfig, b: PaginationConfig): boolean {
    return (
      areFontConfigsEqual(a.fontConfig, b.fontConfig) &&
      a.layoutTheme.lineHeightFactor === b.layoutTheme.lineHeightFactor &&
      a.layoutTheme.paragraphSpacingFactor ===
        b.layoutTheme.paragraphSpacingFactor &&
      a.layoutTheme.headingSpaceAbove === b.layoutTheme.headingSpaceAbove &&
      a.layoutTheme.headingSpaceBelow === b.layoutTheme.headingSpaceBelow &&
      a.layoutTheme.textAlign === b.layoutTheme.textAlign &&
      a.layoutTheme.baseFontSizePx === b.layoutTheme.baseFontSizePx &&
      a.viewport.width === b.viewport.width &&
      a.viewport.height === b.viewport.height
    );
  }

  private resolveRuntime(
    overrides: Partial<PaginationRuntime>,
  ): PaginationRuntime {
    return {
      maybeYield: overrides.maybeYield ?? DEFAULT_RUNTIME.maybeYield,
      isStale: overrides.isStale ?? DEFAULT_RUNTIME.isStale,
    };
  }
}
