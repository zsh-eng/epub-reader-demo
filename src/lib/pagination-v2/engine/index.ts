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
  ResolvedSpread,
  SpreadConfig,
  SpreadIntent,
} from "../types";
import { DEFAULT_SPREAD_CONFIG } from "../types";
import {
  pickAnchorForPage,
  resolveAnchorToGlobalPage,
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

const REPLACE_INTENT: SpreadIntent = { kind: "replace" };

function resolveInitialChapterPageIndex(
  pageCount: number,
  chapterProgress: number | undefined,
): number {
  if (pageCount <= 1 || chapterProgress === undefined) return 0;
  if (!Number.isFinite(chapterProgress)) return 0;

  const clampedProgress = clamp(chapterProgress, 0, 100);
  return Math.round((clampedProgress / 100) * (pageCount - 1));
}

function resolveIntent(command: PaginationCommand): SpreadIntent {
  switch (command.type) {
    case "init":
      return command.intent ?? REPLACE_INTENT;
    case "nextSpread":
    case "prevSpread":
    case "goToPage":
    case "goToChapter":
    case "goToTarget":
      return command.intent;
    case "addChapter":
    case "updateChapter":
    case "updatePaginationConfig":
    case "updateSpreadConfig":
      return REPLACE_INTENT;
  }
}

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
  /** Keeps the current anchor in the same visible slot across 2-up reprojections. */
  private preferredAnchorSlotIndex: number | null = null;

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
    const intent = resolveIntent(cmd);

    try {
      switch (cmd.type) {
        case "init":
          this.init(
            intent,
            cmd.totalChapters,
            cmd.paginationConfig,
            cmd.spreadConfig,
            cmd.initialChapterIndex,
            cmd.initialChapterProgress,
            cmd.initialAnchor,
            cmd.firstChapterBlocks,
          );
          break;
        case "addChapter":
          this.addChapter(intent, cmd.chapterIndex, cmd.blocks);
          break;
        case "updateChapter":
          await this.updateChapter(
            intent,
            cmd.chapterIndex,
            cmd.blocks,
            runtime,
          );
          break;
        case "updatePaginationConfig":
          await this.updatePaginationConfig(
            intent,
            cmd.paginationConfig,
            runtime,
          );
          break;
        case "updateSpreadConfig":
          this.updateSpreadConfig(intent, cmd.spreadConfig);
          break;
        case "nextSpread":
          this.nextSpread(intent);
          break;
        case "prevSpread":
          this.prevSpread(intent);
          break;
        case "goToPage":
          this.goToPage(intent, cmd.page);
          break;
        case "goToChapter":
          this.goToChapter(intent, cmd.chapterIndex);
          break;
        case "goToTarget":
          this.goToTarget(intent, cmd.chapterIndex, cmd.targetId);
          break;
      }
    } catch (err) {
      this.emit({
        type: "error",
        intent,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  init(
    intent: SpreadIntent,
    totalChapters: number,
    paginationConfig: PaginationConfig,
    spreadConfig: SpreadConfig,
    initialChapterIndex: number,
    initialChapterProgress: number | undefined,
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
      const initialChapterPages =
        this.pagesByChapter[this.initialChapterIndex] ?? [];
      const initialPageIndex = resolveInitialChapterPageIndex(
        initialChapterPages.length,
        initialChapterProgress,
      );
      this.anchor = pickAnchorForPage(
        this.pagesByChapter,
        this.initialChapterIndex,
        initialPageIndex,
      );
    }
    this.preferredAnchorSlotIndex = null;

    const spread = this.buildResolvedSpread(intent);
    if (!spread) {
      this.emit({
        type: "error",
        intent,
        message: "Failed to build initial spread after init",
      });
      return;
    }
    this.capturePreferredAnchorSlot(spread);

    if (this.totalChapters === 1) {
      this.emit({
        type: "ready",
        intent,
        epoch: this.epoch,
        spread,
        chapterDiagnostics: diagnostics ? [diagnostics] : [],
      });
    } else {
      this.emit({
        type: "partialReady",
        intent,
        epoch: this.epoch,
        spread,
        chapterDiagnostics: diagnostics,
      });
    }
  }

  addChapter(
    intent: SpreadIntent,
    chapterIndex: number,
    blocks: Block[],
  ): void {
    if (chapterIndex < 0 || chapterIndex >= this.totalChapters) {
      this.emit({
        type: "error",
        intent,
        message: `addChapter: index ${chapterIndex} out of bounds`,
      });
      return;
    }

    if (this.blocksByChapter[chapterIndex] !== null) return;

    this.blocksByChapter[chapterIndex] = blocks;
    const diagnostics = this.prepareAndLayoutChapter(chapterIndex);
    const resolvedSpread = this.buildResolvedSpread(intent);
    if (resolvedSpread) {
      this.capturePreferredAnchorSlot(resolvedSpread);
    }

    if (this.receivedChapters === this.totalChapters) {
      if (!resolvedSpread) return;

      this.emit({
        type: "ready",
        intent,
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
      intent,
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
    intent: SpreadIntent,
    chapterIndex: number,
    blocks: Block[],
    runtime: Partial<PaginationRuntime> = {},
  ): Promise<void> {
    if (chapterIndex < 0 || chapterIndex >= this.totalChapters) {
      this.emit({
        type: "error",
        intent,
        message: `updateChapter: index ${chapterIndex} out of bounds`,
      });
      return;
    }

    if (this.blocksByChapter[chapterIndex] === null) {
      this.emit({
        type: "error",
        intent,
        message: `updateChapter: chapter ${chapterIndex} has not been loaded yet`,
      });
      return;
    }

    this.blocksByChapter[chapterIndex] = blocks;

    await this.runRelayout(
      intent,
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
    intent: SpreadIntent,
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
      // The main thread flips into "recalculating" before the worker decides
      // whether this config update is actually a no-op. Emit a ready event so
      // consumers like the footer never get stranded in a visual loading state
      // after a semantically identical config update.
      const spread = this.buildResolvedSpread(intent);
      if (spread) {
        this.capturePreferredAnchorSlot(spread);
        this.emit({
          type: "ready",
          intent,
          epoch: this.epoch,
          spread,
          chapterDiagnostics: this.chapterDiagnosticsByChapter.filter(
            (diag): diag is PaginationChapterDiagnostics => diag !== null,
          ),
        });
      }
      return;
    }

    const fontChanged = !areFontConfigsEqual(
      this.paginationConfig.fontConfig,
      nextConfig.fontConfig,
    );
    this.paginationConfig = nextConfig;

    if (this.receivedChapters === 0) return;

    if (fontChanged) {
      for (
        let chapterIndex = 0;
        chapterIndex < this.totalChapters;
        chapterIndex++
      ) {
        if (!this.blocksByChapter[chapterIndex]) continue;
        this.preparedByChapter[chapterIndex] = null;
      }
    }

    await this.runRelayout(
      intent,
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
    intent: SpreadIntent,
    nextSpreadConfig: SpreadConfig,
  ): void {
    if (this.areSpreadConfigsEqual(this.spreadConfig, nextSpreadConfig)) return;
    this.spreadConfig = nextSpreadConfig;
    this.preferredAnchorSlotIndex = null;
    if (this.receivedChapters === 0) return;

    this.emitPageContent(intent);
  }

  nextSpread(intent: SpreadIntent): void {
    const currentSpreadIndex = this.resolveCurrentSpreadIndex();
    if (currentSpreadIndex === null) {
      this.emitPageUnavailable(intent);
      return;
    }

    if (!this.setAnchorFromSpreadIndexForLinearTurn(currentSpreadIndex + 1)) {
      this.emitPageUnavailable(intent);
      return;
    }

    this.emitPageContent(intent);
  }

  prevSpread(intent: SpreadIntent): void {
    const currentSpreadIndex = this.resolveCurrentSpreadIndex();
    if (currentSpreadIndex === null) {
      this.emitPageUnavailable(intent);
      return;
    }

    if (!this.setAnchorFromSpreadIndexForLinearTurn(currentSpreadIndex - 1)) {
      this.emitPageUnavailable(intent);
      return;
    }

    this.emitPageContent(intent);
  }

  goToPage(intent: SpreadIntent, globalPage: number): void {
    const pageIndex = Math.max(1, Math.floor(globalPage)) - 1;

    for (
      let chapterIndex = this.chapterPageOffsets.length - 1;
      chapterIndex >= 0;
      chapterIndex--
    ) {
      const offset = this.chapterPageOffsets[chapterIndex];
      if (offset === undefined || pageIndex < offset) continue;

      const localIndex = pageIndex - offset;
      const pages = this.pagesByChapter[chapterIndex];
      if (!pages || localIndex >= pages.length) continue;

      this.preferredAnchorSlotIndex = null;
      this.anchor = pickAnchorForPage(
        this.pagesByChapter,
        chapterIndex,
        localIndex,
      );
      this.emitPageContent(intent);
      return;
    }

    this.emitPageUnavailable(intent);
  }

  goToChapter(intent: SpreadIntent, chapterIndex: number): void {
    const chapter = Math.floor(chapterIndex);
    if (chapter < 0 || chapter >= this.totalChapters) {
      this.emitChapterUnavailable(intent, chapter);
      return;
    }

    const pages = this.pagesByChapter[chapter];
    if (!pages || pages.length === 0) {
      this.emitChapterUnavailable(intent, chapter);
      return;
    }

    this.preferredAnchorSlotIndex = null;
    this.anchor = pickAnchorForPage(this.pagesByChapter, chapter, 0);
    this.emitPageContent(intent);
  }

  goToTarget(
    intent: SpreadIntent,
    chapterIndex: number,
    targetId: string,
  ): void {
    const chapter = Math.floor(chapterIndex);
    if (chapter < 0 || chapter >= this.totalChapters) {
      this.emitChapterUnavailable(intent, chapter);
      return;
    }

    const pages = this.pagesByChapter[chapter];
    if (!pages || pages.length === 0) {
      this.emitChapterUnavailable(intent, chapter);
      return;
    }

    this.preferredAnchorSlotIndex = null;
    this.anchor =
      resolveTargetToAnchor(this.preparedByChapter, chapter, targetId) ??
      pickAnchorForPage(this.pagesByChapter, chapter, 0);
    this.emitPageContent(intent);
  }

  private async runRelayout(
    intent: SpreadIntent,
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

      const spread = this.buildResolvedSpread(intent);
      if (spread) {
        this.capturePreferredAnchorSlot(spread);
      }
      const currentPage = spread?.currentPage ?? 1;
      const totalPages = spread?.totalPages ?? this.totalPages;
      const currentSpread = spread?.currentSpread ?? 1;
      const totalSpreads = spread?.totalSpreads ?? this.totalSpreads;

      if (!emittedPartial && spread) {
        this.emit({
          type: "partialReady",
          intent,
          epoch: this.epoch,
          spread,
          chapterDiagnostics: diagnostics,
        });
        emittedPartial = true;
      } else {
        this.emit({
          type: "progress",
          intent,
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

    const spread = this.buildResolvedSpread(intent);
    if (!spread) return;
    this.capturePreferredAnchorSlot(spread);

    this.emit({
      type: "ready",
      intent,
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
      leadingGapSlots: this.getLeadingGapSlots(),
      pagesByChapter: this.pagesByChapter,
      spreadConfig: this.spreadConfig,
      totalChapters: this.totalChapters,
    });
  }

  private buildResolvedSpread(intent: SpreadIntent) {
    return buildResolvedSpread(intent, this.buildResolvedSpreadState());
  }

  private buildResolvedSpreadState() {
    return {
      anchor: this.anchor,
      chapterPageOffsets: this.chapterPageOffsets,
      isFullyLoaded: this.isFullyLoaded(),
      leadingGapSlots: this.getLeadingGapSlots(),
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
      leadingGapSlots: this.getLeadingGapSlots(),
      pagesByChapter: this.pagesByChapter,
      spreadConfig: this.spreadConfig,
      totalChapters: this.totalChapters,
    });
    if (!anchor) return false;

    this.anchor = anchor;
    return true;
  }

  private setAnchorFromSpreadIndexForLinearTurn(spreadIndex: number): boolean {
    const previousPreferredSlotIndex = this.preferredAnchorSlotIndex;

    // Spread turns should move by the canonical spread width. Slot preservation is
    // reserved for relayout/reprojection so a right-hand anchor does not overlap.
    this.preferredAnchorSlotIndex = null;
    if (this.setAnchorFromSpreadIndex(spreadIndex)) return true;

    this.preferredAnchorSlotIndex = previousPreferredSlotIndex;
    return false;
  }

  private isFullyLoaded(): boolean {
    return this.receivedChapters === this.totalChapters;
  }

  private emitPageContent(intent: SpreadIntent): void {
    const spread = this.buildResolvedSpread(intent);
    if (!spread) {
      this.emitPageUnavailable(intent);
      return;
    }
    this.capturePreferredAnchorSlot(spread);
    this.emit({ type: "pageContent", intent, epoch: this.epoch, spread });
  }

  private emitPageUnavailable(intent: SpreadIntent): void {
    this.emit({ type: "pageUnavailable", intent, epoch: this.epoch });
  }

  private emitChapterUnavailable(
    intent: SpreadIntent,
    chapterIndex: number,
  ): void {
    const event: ChapterUnavailableEvent = {
      type: "chapterUnavailable",
      intent,
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
    for (
      let chapterIndex = 0;
      chapterIndex < this.totalChapters;
      chapterIndex++
    ) {
      if (!this.blocksByChapter[chapterIndex]) continue;
      if (!this.preparedByChapter[chapterIndex]) return false;
    }
    return true;
  }

  private capturePreferredAnchorSlot(spread: ResolvedSpread | null): void {
    if (!spread || !this.shouldPreserveAnchorSlot()) {
      this.preferredAnchorSlotIndex = null;
      return;
    }

    const anchorGlobalPage = resolveAnchorToGlobalPage(
      this.pagesByChapter,
      this.chapterPageOffsets,
      this.anchor,
    );
    if (anchorGlobalPage === null) {
      this.preferredAnchorSlotIndex = null;
      return;
    }

    const anchorSlot = spread.slots.find(
      (
        slot,
      ): slot is Extract<(typeof spread.slots)[number], { kind: "page" }> =>
        slot.kind === "page" && slot.page.currentPage === anchorGlobalPage,
    );
    this.preferredAnchorSlotIndex = anchorSlot?.slotIndex ?? null;
  }

  private getLeadingGapSlots(): number {
    if (!this.shouldPreserveAnchorSlot()) return 0;
    if (this.preferredAnchorSlotIndex === null) return 0;

    const anchorGlobalPage = resolveAnchorToGlobalPage(
      this.pagesByChapter,
      this.chapterPageOffsets,
      this.anchor,
    );
    if (anchorGlobalPage === null) return 0;

    const columns = this.spreadConfig.columns;
    const canonicalSlotIndex = (anchorGlobalPage - 1) % columns;
    return (
      (this.preferredAnchorSlotIndex - canonicalSlotIndex + columns) % columns
    );
  }

  private shouldPreserveAnchorSlot(): boolean {
    return (
      this.spreadConfig.columns === 2 &&
      this.spreadConfig.chapterFlow === "continuous"
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
