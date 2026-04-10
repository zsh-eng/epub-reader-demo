// Engine orchestrator: owns pagination state, handles commands, runs relayouts,
// and delegates anchor/spread calculations to the engine helper modules.
import type {
  ChapterUnavailableEvent,
  PaginationCommand,
  PaginationEvent,
} from "../protocol";
import { layoutPages } from "../shared/layout-pages";
import { prepareBlocks } from "../shared/prepare-blocks";
import type {
  Block,
  Page,
  PaginationChapterDiagnostics,
  PreparedBlock,
} from "../shared/types";
import { areFontConfigsEqual } from "../shared/types";
import type {
  ContentAnchor,
  PaginationConfig,
  SpreadConfig,
} from "../types";
import { DEFAULT_SPREAD_CONFIG } from "../types";
import {
  pickAnchorForPage,
  resolveAnchorToPage,
  resolveTargetToAnchor,
} from "./anchors";
import {
  buildResolvedSpread,
  countTotalSpreads,
  resolveAnchorForSpreadIndex,
  resolveCurrentSpreadIndex,
} from "./spreads";

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type PaginationCause = PaginationCommand["type"];

export class PaginationEngine {
  /** Set by the worker before each command so all emitted events carry the
   *  correct epoch for staleness filtering on the main thread. */
  epoch = 0;

  private emit: (event: PaginationEvent) => void;

  private paginationConfig!: PaginationConfig;
  private spreadConfig: SpreadConfig = DEFAULT_SPREAD_CONFIG;

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
    return this.blocksByChapter.reduce(
      (count, blocks) => count + (blocks === null ? 0 : 1),
      0,
    );
  }

  async handleCommand(
    cmd: PaginationCommand,
    runtime: Partial<PaginationRuntime> = {},
  ): Promise<void> {
    const cause = cmd.type;

    try {
      switch (cause) {
        case "init":
          this.init(
            cause,
            cmd.totalChapters,
            cmd.paginationConfig,
            cmd.spreadConfig,
            cmd.initialChapterIndex,
            cmd.initialAnchor,
            cmd.firstChapterBlocks,
          );
          break;
        case "addChapter":
          this.addChapter(cause, cmd.chapterIndex, cmd.blocks);
          break;
        case "updateChapter":
          await this.updateChapter(cause, cmd.chapterIndex, cmd.blocks, runtime);
          break;
        case "updatePaginationConfig":
          await this.updatePaginationConfig(cause, cmd.paginationConfig, runtime);
          break;
        case "updateSpreadConfig":
          this.updateSpreadConfig(cause, cmd.spreadConfig);
          break;
        case "nextSpread":
          this.nextSpread(cause);
          break;
        case "prevSpread":
          this.prevSpread(cause);
          break;
        case "goToPage":
          this.goToPage(cause, cmd.page);
          break;
        case "goToChapter":
          this.goToChapter(cause, cmd.chapterIndex);
          break;
        case "goToTarget":
          this.goToTarget(cause, cmd.chapterIndex, cmd.targetId);
          break;
      }
    } catch (err) {
      this.emit({
        type: "error",
        cause,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  init(
    cause: "init",
    totalChapters: number,
    paginationConfig: PaginationConfig,
    spreadConfig: SpreadConfig,
    initialChapterIndex: number,
    initialAnchor: ContentAnchor | undefined,
    firstChapterBlocks: Block[],
  ): void {
    this.paginationConfig = paginationConfig;
    this.spreadConfig = spreadConfig;

    this.totalChapters = Math.max(1, totalChapters);
    this.initialChapterIndex = clamp(
      initialChapterIndex,
      0,
      this.totalChapters - 1,
    );

    this.blocksByChapter = Array.from<Block[] | null>({
      length: this.totalChapters,
    }).fill(null);
    this.preparedByChapter = Array.from<PreparedBlock[] | null>({
      length: this.totalChapters,
    }).fill(null);
    this.pagesByChapter = Array.from<Page[] | null>({
      length: this.totalChapters,
    }).fill(null);
    this.chapterDiagnosticsByChapter =
      Array.from<PaginationChapterDiagnostics | null>({
        length: this.totalChapters,
      }).fill(null);

    this.blocksByChapter[this.initialChapterIndex] = firstChapterBlocks;

    const diagnostics = this.prepareAndLayoutChapter(this.initialChapterIndex);

    if (initialAnchor) {
      const resolved = resolveAnchorToPage(this.pagesByChapter, initialAnchor);
      this.anchor = resolved
        ? initialAnchor
        : pickAnchorForPage(this.pagesByChapter, this.initialChapterIndex, 0);
    } else {
      this.anchor = pickAnchorForPage(
        this.pagesByChapter,
        this.initialChapterIndex,
        0,
      );
    }

    const spread = this.buildResolvedSpread(cause);
    if (!spread) {
      this.emit({
        type: "error",
        cause,
        message: "Failed to build initial spread after init",
      });
      return;
    }

    if (this.totalChapters === 1) {
      this.emit({
        type: "ready",
        cause,
        epoch: this.epoch,
        spread,
        chapterDiagnostics: diagnostics ? [diagnostics] : [],
      });
    } else {
      this.emit({
        type: "partialReady",
        cause,
        epoch: this.epoch,
        spread,
        chapterDiagnostics: diagnostics,
      });
    }
  }

  addChapter(cause: "addChapter", chapterIndex: number, blocks: Block[]): void {
    if (chapterIndex < 0 || chapterIndex >= this.totalChapters) {
      this.emit({
        type: "error",
        cause,
        message: `addChapter: index ${chapterIndex} out of bounds`,
      });
      return;
    }

    if (this.blocksByChapter[chapterIndex] !== null) return;

    this.blocksByChapter[chapterIndex] = blocks;
    const diagnostics = this.prepareAndLayoutChapter(chapterIndex);
    const resolvedSpread = this.buildResolvedSpread(cause);

    if (this.receivedChapters === this.totalChapters) {
      if (!resolvedSpread) return;

      this.emit({
        type: "ready",
        cause,
        epoch: this.epoch,
        spread: resolvedSpread,
        chapterDiagnostics: this.chapterDiagnosticsByChapter.filter(
          (diag): diag is PaginationChapterDiagnostics => diag !== null,
        ),
      });
      return;
    }

    this.emit({
      type: "progress",
      cause,
      epoch: this.epoch,
      chaptersCompleted: this.receivedChapters,
      totalChapters: this.totalChapters,
      currentPage: resolvedSpread?.currentPage ?? 1,
      totalPages: resolvedSpread?.totalPages ?? this.totalPages,
      currentSpread: resolvedSpread?.currentSpread ?? 1,
      totalSpreads: resolvedSpread?.totalSpreads ?? this.totalSpreads,
      chapterDiagnostics: diagnostics,
    });
  }

  async updateChapter(
    cause: "updateChapter",
    chapterIndex: number,
    blocks: Block[],
    runtime: Partial<PaginationRuntime> = {},
  ): Promise<void> {
    if (chapterIndex < 0 || chapterIndex >= this.totalChapters) {
      this.emit({
        type: "error",
        cause,
        message: `updateChapter: index ${chapterIndex} out of bounds`,
      });
      return;
    }

    if (this.blocksByChapter[chapterIndex] === null) {
      this.emit({
        type: "error",
        cause,
        message: `updateChapter: chapter ${chapterIndex} has not been loaded yet`,
      });
      return;
    }

    this.blocksByChapter[chapterIndex] = blocks;

    await this.runRelayout(
      cause,
      (chapter) => {
        if (chapter !== chapterIndex || !this.blocksByChapter[chapter]) {
          return null;
        }
        return this.prepareAndLayoutChapter(chapter);
      },
      this.resolveRuntime(runtime),
    );
  }

  async updatePaginationConfig(
    cause: "updatePaginationConfig",
    nextConfig: PaginationConfig,
    runtime: Partial<PaginationRuntime> = {},
  ): Promise<void> {
    if (this.totalChapters === 0) {
      this.paginationConfig = nextConfig;
      return;
    }

    if (
      this.arePaginationConfigsEqual(this.paginationConfig, nextConfig) &&
      this.hasPreparedForLoadedChapters()
    ) {
      this.paginationConfig = nextConfig;
      return;
    }

    const fontChanged = !areFontConfigsEqual(
      this.paginationConfig.fontConfig,
      nextConfig.fontConfig,
    );
    this.paginationConfig = nextConfig;

    if (this.receivedChapters === 0) return;

    if (fontChanged) {
      for (let chapterIndex = 0; chapterIndex < this.totalChapters; chapterIndex++) {
        if (!this.blocksByChapter[chapterIndex]) continue;
        this.preparedByChapter[chapterIndex] = null;
      }
    }

    await this.runRelayout(
      cause,
      (chapterIndex) => {
        if (!this.blocksByChapter[chapterIndex]) return null;

        const prepared = this.preparedByChapter[chapterIndex];
        if (!prepared) {
          return this.prepareAndLayoutChapter(chapterIndex);
        }

        const stage2PrepareMs =
          this.chapterDiagnosticsByChapter[chapterIndex]?.stage2PrepareMs ?? 0;
        return this.layoutPreparedChapter(
          chapterIndex,
          prepared,
          stage2PrepareMs,
        );
      },
      this.resolveRuntime(runtime),
    );
  }

  updateSpreadConfig(
    cause: "updateSpreadConfig",
    nextSpreadConfig: SpreadConfig,
  ): void {
    if (this.areSpreadConfigsEqual(this.spreadConfig, nextSpreadConfig)) return;
    this.spreadConfig = nextSpreadConfig;
    if (this.receivedChapters === 0) return;

    this.emitPageContent(cause);
  }

  nextSpread(cause: "nextSpread"): void {
    const currentSpreadIndex = this.resolveCurrentSpreadIndex();
    if (currentSpreadIndex === null) {
      this.emitPageUnavailable(cause);
      return;
    }

    if (!this.setAnchorFromSpreadIndex(currentSpreadIndex + 1)) {
      this.emitPageUnavailable(cause);
      return;
    }

    this.emitPageContent(cause);
  }

  prevSpread(cause: "prevSpread"): void {
    const currentSpreadIndex = this.resolveCurrentSpreadIndex();
    if (currentSpreadIndex === null) {
      this.emitPageUnavailable(cause);
      return;
    }

    if (!this.setAnchorFromSpreadIndex(currentSpreadIndex - 1)) {
      this.emitPageUnavailable(cause);
      return;
    }

    this.emitPageContent(cause);
  }

  goToPage(cause: "goToPage", globalPage: number): void {
    const pageIndex = Math.max(1, Math.floor(globalPage)) - 1;

    for (let chapterIndex = this.chapterPageOffsets.length - 1; chapterIndex >= 0; chapterIndex--) {
      const offset = this.chapterPageOffsets[chapterIndex];
      if (offset === undefined || pageIndex < offset) continue;

      const localIndex = pageIndex - offset;
      const pages = this.pagesByChapter[chapterIndex];
      if (!pages || localIndex >= pages.length) continue;

      this.anchor = pickAnchorForPage(this.pagesByChapter, chapterIndex, localIndex);
      this.emitPageContent(cause);
      return;
    }

    this.emitPageUnavailable(cause);
  }

  goToChapter(cause: "goToChapter", chapterIndex: number): void {
    const chapter = Math.floor(chapterIndex);
    if (chapter < 0 || chapter >= this.totalChapters) {
      this.emitChapterUnavailable(cause, chapter);
      return;
    }

    const pages = this.pagesByChapter[chapter];
    if (!pages || pages.length === 0) {
      this.emitChapterUnavailable(cause, chapter);
      return;
    }

    this.anchor = pickAnchorForPage(this.pagesByChapter, chapter, 0);
    this.emitPageContent(cause);
  }

  goToTarget(
    cause: "goToTarget",
    chapterIndex: number,
    targetId: string,
  ): void {
    const chapter = Math.floor(chapterIndex);
    if (chapter < 0 || chapter >= this.totalChapters) {
      this.emitChapterUnavailable(cause, chapter);
      return;
    }

    const pages = this.pagesByChapter[chapter];
    if (!pages || pages.length === 0) {
      this.emitChapterUnavailable(cause, chapter);
      return;
    }

    this.anchor =
      resolveTargetToAnchor(this.preparedByChapter, chapter, targetId) ??
      pickAnchorForPage(this.pagesByChapter, chapter, 0);
    this.emitPageContent(cause);
  }

  private async runRelayout(
    cause: PaginationCause,
    relayoutChapter: (
      chapterIndex: number,
    ) => PaginationChapterDiagnostics | null,
    runtime: PaginationRuntime,
  ): Promise<void> {
    const order = this.buildMiddleOutOrder(this.anchor.chapterIndex);
    let emittedPartial = false;

    for (const chapterIndex of order) {
      if (runtime.isStale()) return;

      const diagnostics = relayoutChapter(chapterIndex);
      if (!diagnostics) continue;

      const spread = this.buildResolvedSpread(cause);
      const currentPage = spread?.currentPage ?? 1;
      const totalPages = spread?.totalPages ?? this.totalPages;
      const currentSpread = spread?.currentSpread ?? 1;
      const totalSpreads = spread?.totalSpreads ?? this.totalSpreads;

      if (!emittedPartial && spread) {
        this.emit({
          type: "partialReady",
          cause,
          epoch: this.epoch,
          spread,
          chapterDiagnostics: diagnostics,
        });
        emittedPartial = true;
      } else {
        this.emit({
          type: "progress",
          cause,
          epoch: this.epoch,
          chaptersCompleted: this.receivedChapters,
          totalChapters: this.totalChapters,
          currentPage,
          totalPages,
          currentSpread,
          totalSpreads,
          chapterDiagnostics: diagnostics,
        });
      }

      if (runtime.isStale()) return;
      await runtime.maybeYield();
    }

    if (runtime.isStale()) return;

    const spread = this.buildResolvedSpread(cause);
    if (!spread) return;

    this.emit({
      type: "ready",
      cause,
      epoch: this.epoch,
      spread,
      chapterDiagnostics: this.chapterDiagnosticsByChapter.filter(
        (diag): diag is PaginationChapterDiagnostics => diag !== null,
      ),
    });
  }

  private prepareAndLayoutChapter(
    chapterIndex: number,
  ): PaginationChapterDiagnostics | null {
    const blocks = this.blocksByChapter[chapterIndex];
    if (!blocks) return null;

    const stage2StartedAt = performance.now();
    const prepared = prepareBlocks(blocks, this.paginationConfig.fontConfig);
    const stage2PrepareMs = performance.now() - stage2StartedAt;
    this.preparedByChapter[chapterIndex] = prepared;

    return this.layoutPreparedChapter(chapterIndex, prepared, stage2PrepareMs);
  }

  private layoutPreparedChapter(
    chapterIndex: number,
    prepared: PreparedBlock[],
    stage2PrepareMs: number,
  ): PaginationChapterDiagnostics {
    const { viewport, layoutTheme } = this.paginationConfig;
    const result = layoutPages(
      prepared,
      viewport.width,
      viewport.height,
      layoutTheme,
    );
    this.pagesByChapter[chapterIndex] = result.pages;

    const diagnostics: PaginationChapterDiagnostics = {
      chapterIndex,
      blockCount: result.diagnostics.blockCount,
      lineCount: result.diagnostics.lineCount,
      pageCount: result.pages.length,
      stage2PrepareMs,
      stage3LayoutMs: result.diagnostics.computeMs,
      totalMs: stage2PrepareMs + result.diagnostics.computeMs,
    };
    this.chapterDiagnosticsByChapter[chapterIndex] = diagnostics;
    return diagnostics;
  }

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

  private get totalSpreads(): number {
    return countTotalSpreads({
      chapterPageOffsets: this.chapterPageOffsets,
      isFullyLoaded: this.isFullyLoaded(),
      pagesByChapter: this.pagesByChapter,
      spreadConfig: this.spreadConfig,
      totalChapters: this.totalChapters,
    });
  }

  private buildResolvedSpread(cause: PaginationCause) {
    return buildResolvedSpread(cause, this.buildResolvedSpreadState());
  }

  private buildResolvedSpreadState() {
    return {
      anchor: this.anchor,
      chapterPageOffsets: this.chapterPageOffsets,
      isFullyLoaded: this.isFullyLoaded(),
      pagesByChapter: this.pagesByChapter,
      spreadConfig: this.spreadConfig,
      totalChapters: this.totalChapters,
      totalPages: this.totalPages,
    };
  }

  private resolveCurrentSpreadIndex(): number | null {
    return resolveCurrentSpreadIndex(this.buildResolvedSpreadState());
  }

  private setAnchorFromSpreadIndex(spreadIndex: number): boolean {
    const anchor = resolveAnchorForSpreadIndex(spreadIndex, {
      chapterPageOffsets: this.chapterPageOffsets,
      isFullyLoaded: this.isFullyLoaded(),
      pagesByChapter: this.pagesByChapter,
      spreadConfig: this.spreadConfig,
      totalChapters: this.totalChapters,
    });
    if (!anchor) return false;

    this.anchor = anchor;
    return true;
  }

  private isFullyLoaded(): boolean {
    return this.receivedChapters === this.totalChapters;
  }

  private emitPageContent(cause: PaginationCause): void {
    const spread = this.buildResolvedSpread(cause);
    if (!spread) {
      this.emitPageUnavailable(cause);
      return;
    }
    this.emit({ type: "pageContent", cause, epoch: this.epoch, spread });
  }

  private emitPageUnavailable(cause: PaginationCause): void {
    this.emit({ type: "pageUnavailable", cause, epoch: this.epoch });
  }

  private emitChapterUnavailable(
    cause: "goToChapter" | "goToTarget",
    chapterIndex: number,
  ): void {
    const event: ChapterUnavailableEvent = {
      type: "chapterUnavailable",
      cause,
      epoch: this.epoch,
      chapterIndex,
    };
    this.emit(event);
  }

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

  private arePaginationConfigsEqual(
    a: PaginationConfig,
    b: PaginationConfig,
  ): boolean {
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

  private areSpreadConfigsEqual(a: SpreadConfig, b: SpreadConfig): boolean {
    return a.columns === b.columns && a.chapterFlow === b.chapterFlow;
  }

  private hasPreparedForLoadedChapters(): boolean {
    for (let chapterIndex = 0; chapterIndex < this.totalChapters; chapterIndex++) {
      if (!this.blocksByChapter[chapterIndex]) continue;
      if (!this.preparedByChapter[chapterIndex]) return false;
    }
    return true;
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
