import type {
  ContentAnchor,
  PaginationCommand,
  PaginationEvent,
} from "./engine-types";
import type {
  Block,
  Page,
  PageSlice,
  PaginationConfig,
  PaginationChapterDiagnostics,
  PaginationDiagnostics,
  PreparedBlock,
} from "./types";
import { prepareBlocks } from "./prepare-blocks";
import { layoutPages } from "./layout-pages";

export class PaginationEngine {
  private emit: (event: PaginationEvent) => void;

  private blocksByChapter: (Block[] | null)[] = [];
  private preparedByChapter: (PreparedBlock[] | null)[] = [];
  private pagesByChapter: (Page[] | null)[] = [];
  private chapterDiagnosticsByChapter: (PaginationChapterDiagnostics | null)[] =
    [];
  private chapterPageOffsets: number[] = [];

  private config: PaginationConfig | null = null;

  private totalChapters = 0;
  private receivedChapters = 0;
  private initialChapterIndex = 0;
  private initialChapterReceived = false;
  private lastRequestedGlobalPage: number | null = null;

  constructor(emit: (event: PaginationEvent) => void) {
    this.emit = emit;
  }

  handleCommand(cmd: PaginationCommand): void {
    try {
      switch (cmd.type) {
        case "init":
          this.init(
            cmd.totalChapters,
            cmd.config,
            cmd.initialChapterIndex,
          );
          break;
        case "addChapter":
          this.addChapter(cmd.chapterIndex, cmd.blocks);
          break;
        case "updateConfig":
          this.updateConfig(cmd.config, cmd.anchor);
          break;
        case "getPage":
          this.getPage(cmd.globalPage);
          break;
      }
    } catch (err) {
      this.emit({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private init(
    totalChapters: number,
    config: PaginationConfig,
    initialChapterIndex: number,
  ): void {
    this.config = config;

    this.totalChapters = Math.max(0, totalChapters);
    this.initialChapterIndex =
      this.totalChapters === 0
        ? 0
        : Math.min(Math.max(initialChapterIndex, 0), this.totalChapters - 1);

    this.blocksByChapter = new Array(this.totalChapters).fill(null);
    this.preparedByChapter = new Array(this.totalChapters).fill(null);
    this.pagesByChapter = new Array(this.totalChapters).fill(null);
    this.chapterDiagnosticsByChapter = new Array(this.totalChapters).fill(null);

    this.receivedChapters = 0;
    this.initialChapterReceived = false;
    this.lastRequestedGlobalPage = null;

    this.recomputeOffsets();
  }

  private addChapter(chapterIndex: number, blocks: Block[]): void {
    if (chapterIndex < 0 || chapterIndex >= this.totalChapters) {
      throw new Error(`Chapter index ${chapterIndex} is out of bounds`);
    }

    const hadChapter = this.blocksByChapter[chapterIndex] !== null;
    this.blocksByChapter[chapterIndex] = blocks;

    const chapterDiagnostics = this.prepareAndLayoutChapter(chapterIndex);
    this.recomputeOffsets();

    if (!hadChapter) {
      this.receivedChapters += 1;
    }

    const anchorPage = this.getInitialAnchorPage();

    if (
      chapterIndex === this.initialChapterIndex &&
      !this.initialChapterReceived
    ) {
      this.initialChapterReceived = true;
      this.emitPartialReady(chapterIndex, anchorPage, chapterDiagnostics);

      if (this.receivedChapters === this.totalChapters) {
        this.emitReady(anchorPage);
      }
      return;
    }

    if (this.receivedChapters === this.totalChapters) {
      this.emitReady(anchorPage);
      return;
    }

    this.emit({
      type: "progress",
      chapterIndex,
      chaptersCompleted: this.receivedChapters,
      totalChapters: this.totalChapters,
      runningTotalPages: this.getTotalPages(),
      chapterPageOffsets: [...this.chapterPageOffsets],
      chapterDiagnostics,
    });
  }

  private updateConfig(
    nextConfig: PaginationConfig,
    anchor: ContentAnchor | null,
  ): void {
    const prevConfig = this.config;
    if (!prevConfig) {
      this.config = nextConfig;
      return;
    }

    if (this.areConfigsEqual(prevConfig, nextConfig)) {
      return;
    }

    const fontChanged = !this.areFontConfigsEqual(
      prevConfig.fontConfig,
      nextConfig.fontConfig,
    );
    this.config = nextConfig;

    if (this.totalChapters === 0 || this.receivedChapters === 0) {
      return;
    }

    if (fontChanged) {
      this.relayoutFromBlocks(anchor);
      return;
    }

    this.relayoutPrepared(anchor);
  }

  private relayoutFromBlocks(anchor: ContentAnchor | null): void {
    this.runRelayout(anchor, (chapterIndex) => {
      if (!this.blocksByChapter[chapterIndex]) return null;
      return this.prepareAndLayoutChapter(chapterIndex);
    });
  }

  private relayoutPrepared(anchor: ContentAnchor | null): void {
    this.runRelayout(anchor, (chapterIndex) => {
      const prepared = this.preparedByChapter[chapterIndex];
      if (!prepared) return null;

      const stage2PrepareMs =
        this.chapterDiagnosticsByChapter[chapterIndex]?.stage2PrepareMs ?? 0;

      return this.layoutPreparedChapter(chapterIndex, prepared, stage2PrepareMs);
    });
  }

  private runRelayout(
    anchor: ContentAnchor | null,
    relayoutChapter: (
      chapterIndex: number,
    ) => PaginationChapterDiagnostics | null,
  ): void {
    const centerChapter = this.resolveRelayoutCenterChapter();
    const chapterOrder = this.buildMiddleOutChapterOrder(centerChapter);
    let emittedPartial = false;

    for (const chapterIndex of chapterOrder) {
      const chapterDiagnostics = relayoutChapter(chapterIndex);
      if (!chapterDiagnostics) continue;

      this.recomputeOffsets();

      if (!emittedPartial) {
        const anchorPage = anchor
          ? this.resolveAnchor(anchor)
          : (this.getInitialAnchorPage() ?? 1);
        this.emitPartialReady(chapterIndex, anchorPage, chapterDiagnostics);
        emittedPartial = true;
        continue;
      }

      this.emit({
        type: "progress",
        chapterIndex,
        chaptersCompleted: this.receivedChapters,
        totalChapters: this.totalChapters,
        runningTotalPages: this.getTotalPages(),
        chapterPageOffsets: [...this.chapterPageOffsets],
        chapterDiagnostics,
      });
    }

    this.recomputeOffsets();
    const anchorPage = anchor
      ? this.resolveAnchor(anchor)
      : this.getInitialAnchorPage();
    this.emitReady(anchorPage);
  }

  private getPage(globalPage: number): void {
    const page1 = Math.max(1, Math.floor(globalPage));
    this.lastRequestedGlobalPage = page1;

    const pageContent = this.resolvePageContentForGlobalPage(page1);
    if (!pageContent) {
      this.emit({
        type: "pageUnavailable",
        globalPage: page1,
      });
      return;
    }

    this.emit({
      type: "pageContent",
      globalPage: page1,
      chapterIndex: pageContent.chapterIndex,
      slices: pageContent.slices,
    });
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private areConfigsEqual(
    a: PaginationConfig,
    b: PaginationConfig,
  ): boolean {
    return (
      this.areFontConfigsEqual(a.fontConfig, b.fontConfig) &&
      this.areLayoutThemesEqual(a.layoutTheme, b.layoutTheme) &&
      this.areViewportsEqual(a.viewport, b.viewport)
    );
  }

  private areFontConfigsEqual(
    a: PaginationConfig["fontConfig"],
    b: PaginationConfig["fontConfig"],
  ): boolean {
    return (
      a.bodyFamily === b.bodyFamily &&
      a.headingFamily === b.headingFamily &&
      a.codeFamily === b.codeFamily &&
      a.baseSizePx === b.baseSizePx
    );
  }

  private areLayoutThemesEqual(
    a: PaginationConfig["layoutTheme"],
    b: PaginationConfig["layoutTheme"],
  ): boolean {
    return (
      a.lineHeightFactor === b.lineHeightFactor &&
      a.paragraphSpacingFactor === b.paragraphSpacingFactor &&
      a.headingSpaceAbove === b.headingSpaceAbove &&
      a.headingSpaceBelow === b.headingSpaceBelow &&
      a.textAlign === b.textAlign &&
      a.baseFontSizePx === b.baseFontSizePx
    );
  }

  private areViewportsEqual(
    a: PaginationConfig["viewport"],
    b: PaginationConfig["viewport"],
  ): boolean {
    return a.width === b.width && a.height === b.height;
  }

  private emitReady(anchorPage: number | null): void {
    this.updateLastRequestedPage(anchorPage);
    const readyPage = anchorPage ?? 1;
    const pageContent = this.resolvePageContentForGlobalPage(readyPage);
    this.emit({
      type: "ready",
      totalPages: this.getTotalPages(),
      anchorPage,
      slicesChapterIndex: pageContent?.chapterIndex ?? null,
      slices: pageContent?.slices ?? [],
      diagnostics: this.buildDiagnostics(),
      chapterPageOffsets: [...this.chapterPageOffsets],
    });
  }

  private emitPartialReady(
    chapterIndex: number,
    anchorPage: number | null,
    chapterDiagnostics: PaginationChapterDiagnostics | null,
  ): void {
    this.updateLastRequestedPage(anchorPage);
    const readyPage = anchorPage ?? 1;
    const pageContent = this.resolvePageContentForGlobalPage(readyPage);
    this.emit({
      type: "partialReady",
      chapterIndex,
      chapterPageCount: this.pagesByChapter[chapterIndex]?.length ?? 0,
      estimatedTotalPages: this.estimateTotalPages(),
      anchorPage,
      slicesChapterIndex: pageContent?.chapterIndex ?? null,
      slices: pageContent?.slices ?? [],
      chapterPageOffsets: [...this.chapterPageOffsets],
      chapterDiagnostics,
    });
  }

  private updateLastRequestedPage(globalPage: number | null): void {
    if (globalPage === null) return;
    this.lastRequestedGlobalPage = Math.max(1, globalPage);
  }

  private prepareAndLayoutChapter(
    chapterIndex: number,
  ): PaginationChapterDiagnostics | null {
    const config = this.config;
    if (!config) return null;

    const blocks = this.blocksByChapter[chapterIndex];
    if (!blocks) return null;

    const stage2StartedAt = performance.now();
    const prepared = prepareBlocks(blocks, config.fontConfig);
    const stage2PrepareMs = performance.now() - stage2StartedAt;
    this.preparedByChapter[chapterIndex] = prepared;

    return this.layoutPreparedChapter(chapterIndex, prepared, stage2PrepareMs);
  }

  private layoutPreparedChapter(
    chapterIndex: number,
    prepared: PreparedBlock[],
    stage2PrepareMs: number,
  ): PaginationChapterDiagnostics {
    const config = this.config;
    if (!config) {
      throw new Error("Pagination config is not initialized");
    }

    const result = layoutPages(
      prepared,
      config.viewport.width,
      config.viewport.height,
      config.layoutTheme,
    );
    this.pagesByChapter[chapterIndex] = result.pages;

    const chapterDiagnostics: PaginationChapterDiagnostics = {
      chapterIndex,
      blockCount: result.diagnostics.blockCount,
      lineCount: result.diagnostics.lineCount,
      pageCount: result.pages.length,
      stage2PrepareMs,
      stage3LayoutMs: result.diagnostics.computeMs,
      totalMs: stage2PrepareMs + result.diagnostics.computeMs,
    };

    this.chapterDiagnosticsByChapter[chapterIndex] = chapterDiagnostics;
    return chapterDiagnostics;
  }

  private recomputeOffsets(): void {
    const offsets: number[] = [];
    let running = 0;
    for (let i = 0; i < this.totalChapters; i++) {
      offsets.push(running);
      running += this.pagesByChapter[i]?.length ?? 0;
    }
    this.chapterPageOffsets = offsets;
  }

  private getTotalPages(): number {
    let total = 0;
    for (const pages of this.pagesByChapter) {
      total += pages?.length ?? 0;
    }
    return Math.max(1, total);
  }

  private estimateTotalPages(): number {
    let loadedChapterCount = 0;
    let loadedPageCount = 0;

    for (let i = 0; i < this.totalChapters; i++) {
      if (!this.blocksByChapter[i]) continue;
      loadedChapterCount += 1;
      loadedPageCount += this.pagesByChapter[i]?.length ?? 0;
    }

    if (loadedChapterCount === 0 || this.totalChapters === 0) {
      return 1;
    }

    const estimated = Math.round(
      (loadedPageCount / loadedChapterCount) * this.totalChapters,
    );
    return Math.max(1, estimated);
  }

  private getInitialAnchorPage(): number | null {
    const pages = this.pagesByChapter[this.initialChapterIndex];
    if (!pages || pages.length === 0) return null;

    const offset = this.chapterPageOffsets[this.initialChapterIndex] ?? 0;
    return offset + 1;
  }

  private resolvePageContentForGlobalPage(globalPage: number): {
    chapterIndex: number;
    slices: PageSlice[];
  } | null {
    const page1 = Math.max(1, Math.floor(globalPage));
    const pageIndex = page1 - 1;

    for (let ch = this.chapterPageOffsets.length - 1; ch >= 0; ch--) {
      const offset = this.chapterPageOffsets[ch];
      if (offset === undefined || pageIndex < offset) continue;

      const localIndex = pageIndex - offset;
      const pages = this.pagesByChapter[ch];
      if (!pages || localIndex >= pages.length) continue;

      return {
        chapterIndex: ch,
        slices: pages[localIndex]?.slices ?? [],
      };
    }

    return null;
  }

  private resolveAnchor(anchor: ContentAnchor): number | null {
    const { chapterIndex, blockId } = anchor;
    const pages = this.pagesByChapter[chapterIndex];
    if (!pages) return null;

    const offset = this.chapterPageOffsets[chapterIndex] ?? 0;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) continue;
      for (const slice of page.slices) {
        if (slice.blockId === blockId) {
          return offset + i + 1; // 1-indexed
        }
      }
    }

    // Fallback: return start of chapter
    return offset + 1;
  }

  private resolveChapterIndexForGlobalPage(globalPage: number): number | null {
    if (this.totalChapters === 0) return null;

    const page1 = Math.min(
      Math.max(1, Math.floor(globalPage)),
      this.getTotalPages(),
    );
    return this.resolvePageContentForGlobalPage(page1)?.chapterIndex ?? null;
  }

  private resolveRelayoutCenterChapter(): number {
    if (this.lastRequestedGlobalPage !== null) {
      const chapterIndex = this.resolveChapterIndexForGlobalPage(
        this.lastRequestedGlobalPage,
      );
      if (chapterIndex !== null) {
        return chapterIndex;
      }
    }

    return this.initialChapterIndex;
  }

  private buildMiddleOutChapterOrder(centerChapter: number): number[] {
    if (this.totalChapters <= 0) return [];

    const center = Math.min(
      Math.max(centerChapter, 0),
      this.totalChapters - 1,
    );
    const order: number[] = [center];

    for (let delta = 1; order.length < this.totalChapters; delta++) {
      const right = center + delta;
      if (right < this.totalChapters) {
        order.push(right);
      }

      const left = center - delta;
      if (left >= 0) {
        order.push(left);
      }
    }

    return order;
  }

  private buildDiagnostics(): PaginationDiagnostics {
    let blockCount = 0;
    let lineCount = 0;
    let stage2PrepareMs = 0;
    let stage3LayoutMs = 0;

    const chapterTimings: PaginationChapterDiagnostics[] = [];

    for (const chapter of this.chapterDiagnosticsByChapter) {
      if (!chapter) continue;
      blockCount += chapter.blockCount;
      lineCount += chapter.lineCount;
      stage2PrepareMs += chapter.stage2PrepareMs ?? 0;
      stage3LayoutMs += chapter.stage3LayoutMs ?? 0;
      chapterTimings.push({ ...chapter });
    }

    const computeMs = stage2PrepareMs + stage3LayoutMs;

    return {
      blockCount,
      lineCount,
      computeMs,
      stage2PrepareMs,
      stage3LayoutMs,
      totalMs: computeMs,
      chapterCount: chapterTimings.length,
      chapterTimings,
    };
  }
}
