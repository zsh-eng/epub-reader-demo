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
  TextCursorOffset,
} from "./types";
import { prepareBlocks } from "./prepare-blocks";
import { layoutPages } from "./layout-pages";

export interface PaginationRuntime {
  maybeYield: () => void | Promise<void>;
  isStale: () => boolean;
}

const DEFAULT_RUNTIME: PaginationRuntime = {
  maybeYield: () => {},
  isStale: () => false,
};

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
  private resolvedContentAnchor: ContentAnchor | null = null;

  constructor(emit: (event: PaginationEvent) => void) {
    this.emit = emit;
  }

  async handleCommand(
    cmd: PaginationCommand,
    runtimeOverrides: Partial<PaginationRuntime> = {},
  ): Promise<void> {
    const runtime = this.resolveRuntime(runtimeOverrides);

    try {
      switch (cmd.type) {
        case "init":
          this.init(
            cmd.totalChapters,
            cmd.config,
            cmd.initialChapterIndex,
            cmd.initialAnchor ?? null,
          );
          break;
        case "addChapter":
          this.addChapter(cmd.chapterIndex, cmd.blocks);
          break;
        case "updateConfig":
          await this.updateConfig(cmd.config, runtime);
          break;
        case "getPage":
          this.getPage(cmd.globalPage);
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

  private init(
    totalChapters: number,
    config: PaginationConfig,
    initialChapterIndex: number,
    initialAnchor: ContentAnchor | null,
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
    this.resolvedContentAnchor = this.normalizeAnchor(initialAnchor);

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

    const resolvedPage =
      this.resolveStoredAnchorPage() ?? this.getInitialAnchorPage();

    if (
      chapterIndex === this.initialChapterIndex &&
      !this.initialChapterReceived
    ) {
      this.initialChapterReceived = true;
      this.emitPartialReady(chapterIndex, resolvedPage, chapterDiagnostics);

      if (this.receivedChapters === this.totalChapters) {
        this.emitReady(resolvedPage);
      }
      return;
    }

    if (this.receivedChapters === this.totalChapters) {
      this.emitReady(resolvedPage);
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
    runtime: PaginationRuntime,
  ): Promise<void> {
    const prevConfig = this.config;
    if (!prevConfig) {
      this.config = nextConfig;
      return Promise.resolve();
    }

    if (this.areConfigsEqual(prevConfig, nextConfig)) {
      return Promise.resolve();
    }

    const fontChanged = !this.areFontConfigsEqual(
      prevConfig.fontConfig,
      nextConfig.fontConfig,
    );
    this.config = nextConfig;

    if (this.totalChapters === 0 || this.receivedChapters === 0) {
      return Promise.resolve();
    }

    if (fontChanged) {
      return this.relayoutFromBlocks(runtime);
    }

    return this.relayoutPrepared(runtime);
  }

  private relayoutFromBlocks(runtime: PaginationRuntime): Promise<void> {
    return this.runRelayout(
      (chapterIndex) => {
        if (!this.blocksByChapter[chapterIndex]) return null;
        return this.prepareAndLayoutChapter(chapterIndex);
      },
      runtime,
    );
  }

  private relayoutPrepared(runtime: PaginationRuntime): Promise<void> {
    return this.runRelayout(
      (chapterIndex) => {
        const prepared = this.preparedByChapter[chapterIndex];
        if (!prepared) return null;

        const stage2PrepareMs =
          this.chapterDiagnosticsByChapter[chapterIndex]?.stage2PrepareMs ?? 0;

        return this.layoutPreparedChapter(
          chapterIndex,
          prepared,
          stage2PrepareMs,
        );
      },
      runtime,
    );
  }

  private async runRelayout(
    relayoutChapter: (
      chapterIndex: number,
    ) => PaginationChapterDiagnostics | null,
    runtime: PaginationRuntime,
  ): Promise<void> {
    const centerChapter = this.resolveRelayoutCenterChapter();
    const chapterOrder = this.buildMiddleOutChapterOrder(centerChapter);
    let emittedPartial = false;

    for (const chapterIndex of chapterOrder) {
      if (runtime.isStale()) return;

      const chapterDiagnostics = relayoutChapter(chapterIndex);
      if (!chapterDiagnostics) continue;

      this.recomputeOffsets();

      if (!emittedPartial) {
        const resolvedPage =
          this.resolveStoredAnchorPage() ?? (this.getInitialAnchorPage() ?? 1);
        this.emitPartialReady(chapterIndex, resolvedPage, chapterDiagnostics);
        emittedPartial = true;
      } else {
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

      if (runtime.isStale()) return;

      const maybeYieldResult = runtime.maybeYield();
      if (this.isPromiseLike(maybeYieldResult)) {
        await maybeYieldResult;
      }
    }

    if (runtime.isStale()) return;

    this.recomputeOffsets();
    if (runtime.isStale()) return;

    const resolvedPage =
      this.resolveStoredAnchorPage() ?? this.getInitialAnchorPage();
    this.emitReady(resolvedPage);
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

    this.updateResolvedAnchorFromPageContent(pageContent);

    this.emit({
      type: "pageContent",
      globalPage: page1,
      chapterIndex: pageContent.chapterIndex,
      slices: pageContent.slices,
      resolvedAnchor: this.cloneAnchor(this.resolvedContentAnchor),
    });
  }

  private goToChapter(chapterIndex: number): void {
    const chapter = Math.floor(chapterIndex);
    if (chapter < 0 || chapter >= this.totalChapters) {
      throw new Error(`Chapter index ${chapterIndex} is out of bounds`);
    }

    const targetPage = this.resolveFirstPageForChapter(chapter);
    if (targetPage === null) {
      const unresolvedPage = (this.chapterPageOffsets[chapter] ?? 0) + 1;
      this.emit({
        type: "pageUnavailable",
        globalPage: unresolvedPage,
      });
      return;
    }

    this.getPage(targetPage);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private resolveRuntime(
    runtimeOverrides: Partial<PaginationRuntime>,
  ): PaginationRuntime {
    return {
      maybeYield: runtimeOverrides.maybeYield ?? DEFAULT_RUNTIME.maybeYield,
      isStale: runtimeOverrides.isStale ?? DEFAULT_RUNTIME.isStale,
    };
  }

  private isPromiseLike(value: unknown): value is PromiseLike<void> {
    if (typeof value !== "object" || value === null) return false;
    if (!("then" in value)) return false;
    return typeof value.then === "function";
  }

  private normalizeAnchor(anchor: ContentAnchor | null): ContentAnchor | null {
    if (!anchor) return null;
    if (typeof anchor.blockId !== "string") return null;

    const chapterIndex = Math.floor(anchor.chapterIndex);
    if (!Number.isFinite(chapterIndex)) return null;
    if (chapterIndex < 0 || chapterIndex >= this.totalChapters) return null;

    const blockId = anchor.blockId.trim();
    if (!blockId) return null;

    const offset = this.normalizeOffset(anchor.offset);
    if (!offset) {
      return {
        chapterIndex,
        blockId,
      };
    }

    return {
      chapterIndex,
      blockId,
      offset,
    };
  }

  private normalizeOffset(
    offset: TextCursorOffset | undefined,
  ): TextCursorOffset | null {
    if (!offset) return null;

    const itemIndex = Math.floor(offset.itemIndex);
    const segmentIndex = Math.floor(offset.segmentIndex);
    const graphemeIndex = Math.floor(offset.graphemeIndex);

    if (!Number.isFinite(itemIndex) || itemIndex < 0) return null;
    if (!Number.isFinite(segmentIndex) || segmentIndex < 0) return null;
    if (!Number.isFinite(graphemeIndex) || graphemeIndex < 0) return null;

    return {
      itemIndex,
      segmentIndex,
      graphemeIndex,
    };
  }

  private cloneOffset(offset: TextCursorOffset): TextCursorOffset {
    return {
      itemIndex: offset.itemIndex,
      segmentIndex: offset.segmentIndex,
      graphemeIndex: offset.graphemeIndex,
    };
  }

  private cloneAnchor(anchor: ContentAnchor | null): ContentAnchor | null {
    if (!anchor) return null;

    return {
      chapterIndex: anchor.chapterIndex,
      blockId: anchor.blockId,
      offset: anchor.offset ? this.cloneOffset(anchor.offset) : undefined,
    };
  }

  private compareOffsets(a: TextCursorOffset, b: TextCursorOffset): number {
    if (a.itemIndex !== b.itemIndex) {
      return a.itemIndex < b.itemIndex ? -1 : 1;
    }
    if (a.segmentIndex !== b.segmentIndex) {
      return a.segmentIndex < b.segmentIndex ? -1 : 1;
    }
    if (a.graphemeIndex !== b.graphemeIndex) {
      return a.graphemeIndex < b.graphemeIndex ? -1 : 1;
    }
    return 0;
  }

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

  private emitReady(resolvedPage: number | null): void {
    this.updateLastRequestedPage(resolvedPage);
    const readyPage = resolvedPage ?? 1;
    const pageContent = this.resolvePageContentForGlobalPage(readyPage);
    this.updateResolvedAnchorFromPageContent(pageContent);
    const resolvedAnchor = this.cloneAnchor(this.resolvedContentAnchor);
    this.emit({
      type: "ready",
      totalPages: this.getTotalPages(),
      resolvedPage,
      resolvedAnchor,
      slicesChapterIndex: pageContent?.chapterIndex ?? null,
      slices: pageContent?.slices ?? [],
      diagnostics: this.buildDiagnostics(),
      chapterPageOffsets: [...this.chapterPageOffsets],
    });
  }

  private emitPartialReady(
    chapterIndex: number,
    resolvedPage: number | null,
    chapterDiagnostics: PaginationChapterDiagnostics | null,
  ): void {
    this.updateLastRequestedPage(resolvedPage);
    const readyPage = resolvedPage ?? 1;
    const pageContent = this.resolvePageContentForGlobalPage(readyPage);
    this.updateResolvedAnchorFromPageContent(pageContent);
    const resolvedAnchor = this.cloneAnchor(this.resolvedContentAnchor);
    this.emit({
      type: "partialReady",
      chapterIndex,
      chapterPageCount: this.pagesByChapter[chapterIndex]?.length ?? 0,
      estimatedTotalPages: this.estimateTotalPages(),
      resolvedPage,
      resolvedAnchor,
      slicesChapterIndex: pageContent?.chapterIndex ?? null,
      slices: pageContent?.slices ?? [],
      chapterPageOffsets: [...this.chapterPageOffsets],
      chapterDiagnostics,
    });
  }

  private updateResolvedAnchorFromPageContent(pageContent: {
    chapterIndex: number;
    slices: PageSlice[];
  } | null): void {
    if (!pageContent) return;
    // TODO: we should use the middle slice instead for anchoring - it's more accurate and less prone to the page shifting around
    // const middleSliceBlockId = pageContent.slices[Math.floor(pageContent.slices.length / 2)].blockId;
    // this.resolvedContentAnchor = {
    //   chapterIndex: pageContent.chapterIndex,
    //   blockId: middleSliceBlockId,
    // };
    // return

    const textSlice = pageContent.slices.find((slice) => {
      if (slice.type !== "text") return false;
      return slice.lines.some((line) => line.startOffset !== undefined);
    });
    if (textSlice?.type === "text") {
      const firstLineWithOffset = textSlice.lines.find(
        (line) => line.startOffset !== undefined,
      );
      if (firstLineWithOffset?.startOffset) {
        this.resolvedContentAnchor = {
          chapterIndex: pageContent.chapterIndex,
          blockId: textSlice.blockId,
          offset: this.cloneOffset(firstLineWithOffset.startOffset),
        };
        return;
      }
    }

    const imageSlice = pageContent.slices.find((slice) => slice.type === "image");
    if (imageSlice) {
      this.resolvedContentAnchor = {
        chapterIndex: pageContent.chapterIndex,
        blockId: imageSlice.blockId,
      };
      return;
    }

    const spacerSlice = pageContent.slices.find(
      (slice) => slice.type === "spacer",
    );
    if (spacerSlice) {
      this.resolvedContentAnchor = {
        chapterIndex: pageContent.chapterIndex,
        blockId: spacerSlice.blockId,
      };
      return;
    }

    const firstSlice = pageContent.slices[0];
    if (!firstSlice) return;

    this.resolvedContentAnchor = {
      chapterIndex: pageContent.chapterIndex,
      blockId: firstSlice.blockId,
    };
  }

  private resolveStoredAnchorPage(): number | null {
    if (!this.resolvedContentAnchor) return null;
    return this.resolveAnchor(this.resolvedContentAnchor);
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

  private resolveFirstPageForChapter(chapterIndex: number): number | null {
    const pages = this.pagesByChapter[chapterIndex];
    if (!pages || pages.length === 0) return null;

    const offset = this.chapterPageOffsets[chapterIndex] ?? 0;
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
    const { chapterIndex, blockId, offset: anchorOffset } = anchor;
    const pages = this.pagesByChapter[chapterIndex];
    if (!pages) return null;

    const offset = this.chapterPageOffsets[chapterIndex] ?? 0;
    let firstBlockPageIndex: number | null = null;
    let nearestPrecedingPageIndex: number | null = null;
    let nearestPrecedingEnd: TextCursorOffset | null = null;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) continue;
      for (const slice of page.slices) {
        if (slice.blockId !== blockId) continue;

        if (firstBlockPageIndex === null) {
          firstBlockPageIndex = i;
        }

        if (!anchorOffset || slice.type !== "text") continue;

        for (const line of slice.lines) {
          const lineStart = line.startOffset;
          const lineEnd = line.endOffset;
          if (!lineStart || !lineEnd) continue;

          const startCompare = this.compareOffsets(lineStart, anchorOffset);
          const endCompare = this.compareOffsets(anchorOffset, lineEnd);
          if (startCompare <= 0 && endCompare < 0) {
            return offset + i + 1;
          }

          if (this.compareOffsets(lineEnd, anchorOffset) <= 0) {
            if (
              !nearestPrecedingEnd ||
              this.compareOffsets(lineEnd, nearestPrecedingEnd) > 0
            ) {
              nearestPrecedingEnd = lineEnd;
              nearestPrecedingPageIndex = i;
            }
          }
        }
      }
    }

    if (nearestPrecedingPageIndex !== null) {
      return offset + nearestPrecedingPageIndex + 1;
    }

    if (firstBlockPageIndex !== null) {
      return offset + firstBlockPageIndex + 1;
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
