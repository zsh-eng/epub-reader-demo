// Engine orchestrator: owns pagination state, creates stepwise pagination jobs,
// and delegates anchor/spread calculations to the engine helper modules.
import type {
    ChapterUnavailableEvent,
    ErrorEvent,
    PageContentEvent,
    PageUnavailableEvent,
    PaginationCommand,
    PartialReadyEvent,
    ProgressEvent,
    ReadyEvent,
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

export type EnginePaginationEvent =
  | Omit<PartialReadyEvent, "epoch">
  | Omit<ReadyEvent, "epoch">
  | Omit<ProgressEvent, "epoch">
  | Omit<PageContentEvent, "epoch">
  | Omit<PageUnavailableEvent, "epoch">
  | Omit<ChapterUnavailableEvent, "epoch">
  | ErrorEvent;

export interface PaginationEngineJob {
  commandType: PaginationCommand["type"];
  readonly done: boolean;
  step: () => void;
}

interface RelayoutPlan {
  order: number[];
  relayoutChapter: (
    chapterIndex: number,
  ) => PaginationChapterDiagnostics | null;
}

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
  private emit: (event: EnginePaginationEvent) => void;

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

  constructor(emit: (event: EnginePaginationEvent) => void) {
    this.emit = emit;
  }

  get receivedChapters(): number {
    return this.blocksByChapter.reduce(
      (count, blocks) => count + (blocks === null ? 0 : 1),
      0,
    );
  }

  createJob(cmd: PaginationCommand): PaginationEngineJob {
    const intent = resolveIntent(cmd);

    switch (cmd.type) {
      case "init":
        return this.createOneStepJob(cmd.type, intent, () => {
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
        });
      case "addChapter":
        return this.createOneStepJob(cmd.type, intent, () => {
          this.addChapter(intent, cmd.chapterIndex, cmd.blocks);
        });
      case "updateChapter":
        return this.createUpdateChapterJob(intent, cmd.chapterIndex, cmd.blocks);
      case "updatePaginationConfig":
        return this.createUpdatePaginationConfigJob(
          intent,
          cmd.paginationConfig,
        );
      case "updateSpreadConfig":
        return this.createOneStepJob(cmd.type, intent, () => {
          this.updateSpreadConfig(intent, cmd.spreadConfig);
        });
      case "nextSpread":
        return this.createOneStepJob(cmd.type, intent, () => {
          this.nextSpread(intent);
        });
      case "prevSpread":
        return this.createOneStepJob(cmd.type, intent, () => {
          this.prevSpread(intent);
        });
      case "goToPage":
        return this.createOneStepJob(cmd.type, intent, () => {
          this.goToPage(intent, cmd.page);
        });
      case "goToChapter":
        return this.createOneStepJob(cmd.type, intent, () => {
          this.goToChapter(intent, cmd.chapterIndex);
        });
      case "goToTarget":
        return this.createOneStepJob(cmd.type, intent, () => {
          this.goToTarget(intent, cmd.chapterIndex, cmd.targetId);
        });
    }
  }

  private createOneStepJob(
    commandType: PaginationCommand["type"],
    intent: SpreadIntent,
    run: () => void,
  ): PaginationEngineJob {
    let done = false;

    return {
      commandType,
      get done() {
        return done;
      },
      step: () => {
        if (done) return;

        try {
          run();
        } catch (err) {
          this.emitException(intent, err);
        } finally {
          done = true;
        }
      },
    };
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
        spread,
        chapterDiagnostics: diagnostics ? [diagnostics] : [],
      });
    } else {
      this.emit({
        type: "partialReady",
        intent,
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
        spread: resolvedSpread,
        chapterDiagnostics: this.chapterDiagnosticsByChapter.filter(
          (diag): diag is PaginationChapterDiagnostics => diag !== null,
        ),
      });
      return;
    }

    if (
      resolvedSpread &&
      this.spreadContainsChapter(resolvedSpread, chapterIndex)
    ) {
      this.emit({
        type: "partialReady",
        intent,
        spread: resolvedSpread,
        chapterDiagnostics: diagnostics,
      });
      return;
    }

    this.emit({
      type: "progress",
      intent,
      chaptersCompleted: this.receivedChapters,
      totalChapters: this.totalChapters,
      currentPage: resolvedSpread?.currentPage ?? 1,
      totalPages: resolvedSpread?.totalPages ?? this.totalPages,
      currentSpread: resolvedSpread?.currentSpread ?? 1,
      totalSpreads: resolvedSpread?.totalSpreads ?? this.totalSpreads,
      chapterDiagnostics: diagnostics,
    });
  }

  private createUpdateChapterJob(
    intent: SpreadIntent,
    chapterIndex: number,
    blocks: Block[],
  ): PaginationEngineJob {
    return this.createDeferredRelayoutJob("updateChapter", intent, () => {
      if (chapterIndex < 0 || chapterIndex >= this.totalChapters) {
        this.emitErrorMessage(
          intent,
          `updateChapter: index ${chapterIndex} out of bounds`,
        );
        return null;
      }

      if (this.blocksByChapter[chapterIndex] === null) {
        this.emitErrorMessage(
          intent,
          `updateChapter: chapter ${chapterIndex} has not been loaded yet`,
        );
        return null;
      }

      this.blocksByChapter[chapterIndex] = blocks;

      return {
        order: [chapterIndex],
        relayoutChapter: (chapter) => {
          if (!this.blocksByChapter[chapter]) return null;
          return this.prepareAndLayoutChapter(chapter);
        },
      };
    });
  }

  private createUpdatePaginationConfigJob(
    intent: SpreadIntent,
    nextConfig: PaginationConfig,
  ): PaginationEngineJob {
    return this.createDeferredRelayoutJob(
      "updatePaginationConfig",
      intent,
      () => {
        if (this.totalChapters === 0) {
          this.paginationConfig = nextConfig;
          return null;
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
          this.emitReady(intent);
          return null;
        }

        const fontChanged = !areFontConfigsEqual(
          this.paginationConfig.fontConfig,
          nextConfig.fontConfig,
        );
        this.paginationConfig = nextConfig;

        if (this.receivedChapters === 0) return null;

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

        return {
          order: this.buildMiddleOutOrder(this.anchor.chapterIndex),
          relayoutChapter: (chapterIndex) => {
            if (!this.blocksByChapter[chapterIndex]) return null;

            const prepared = this.preparedByChapter[chapterIndex];
            if (!prepared) {
              return this.prepareAndLayoutChapter(chapterIndex);
            }

            const stage2PrepareMs =
              this.chapterDiagnosticsByChapter[chapterIndex]?.stage2PrepareMs ??
              0;
            return this.layoutPreparedChapter(
              chapterIndex,
              prepared,
              stage2PrepareMs,
            );
          },
        };
      },
    );
  }

  private createDeferredRelayoutJob(
    commandType: PaginationCommand["type"],
    intent: SpreadIntent,
    createPlan: () => RelayoutPlan | null,
  ): PaginationEngineJob {
    // Relayout commands may wait in the worker while higher-priority navigation
    // runs. Defer validation and plan construction until the first step so the
    // plan reflects the engine state at execution time, not enqueue time.
    let done = false;
    let relayoutJob: PaginationEngineJob | null = null;

    return {
      commandType,
      get done() {
        return done;
      },
      step: () => {
        if (done) return;

        try {
          if (!relayoutJob) {
            const plan = createPlan();
            if (!plan) {
              done = true;
              return;
            }
            relayoutJob = this.createRelayoutJob(commandType, intent, plan);
          }

          relayoutJob.step();
          if (relayoutJob.done) done = true;
        } catch (err) {
          this.emitException(intent, err);
          done = true;
        }
      },
    };
  }

  private createRelayoutJob(
    commandType: PaginationCommand["type"],
    intent: SpreadIntent,
    plan: RelayoutPlan,
  ): PaginationEngineJob {
    // The concrete relayout job owns only the continuation state for an already
    // constructed plan: each step relayouts one available chapter, and the final
    // step emits ready.
    let cursor = 0;
    let done = false;

    return {
      commandType,
      get done() {
        return done;
      },
      step: () => {
        if (done) return;

        try {
          while (cursor < plan.order.length) {
            const chapterIndex = plan.order[cursor];
            cursor++;
            if (chapterIndex === undefined) continue;

            const diagnostics = plan.relayoutChapter(chapterIndex);
            if (!diagnostics) continue;

            this.emitRelayoutProgress(intent, chapterIndex, diagnostics);
            return;
          }

          this.emitReady(intent);
          done = true;
        } catch (err) {
          this.emitException(intent, err);
          done = true;
        }
      },
    };
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

  private emitRelayoutProgress(
    intent: SpreadIntent,
    chapterIndex: number,
    diagnostics: PaginationChapterDiagnostics,
  ): void {
    const spread = this.buildResolvedSpread(intent);
    if (spread) {
      this.capturePreferredAnchorSlot(spread);
    }
    const currentPage = spread?.currentPage ?? 1;
    const totalPages = spread?.totalPages ?? this.totalPages;
    const currentSpread = spread?.currentSpread ?? 1;
    const totalSpreads = spread?.totalSpreads ?? this.totalSpreads;

    if (spread && this.spreadContainsChapter(spread, chapterIndex)) {
      this.emit({
        type: "partialReady",
        intent,
        spread,
        chapterDiagnostics: diagnostics,
      });
      return;
    }

    this.emit({
      type: "progress",
      intent,
      chaptersCompleted: this.receivedChapters,
      totalChapters: this.totalChapters,
      currentPage,
      totalPages,
      currentSpread,
      totalSpreads,
      chapterDiagnostics: diagnostics,
    });
  }

  private emitReady(intent: SpreadIntent): void {
    const spread = this.buildResolvedSpread(intent);
    if (!spread) return;
    this.capturePreferredAnchorSlot(spread);

    this.emit({
      type: "ready",
      intent,
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
    this.emit({ type: "pageContent", intent, spread });
  }

  private emitPageUnavailable(intent: SpreadIntent): void {
    this.emit({ type: "pageUnavailable", intent });
  }

  private emitChapterUnavailable(
    intent: SpreadIntent,
    chapterIndex: number,
  ): void {
    const event: Omit<ChapterUnavailableEvent, "epoch"> = {
      type: "chapterUnavailable",
      intent,
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

  private spreadContainsChapter(
    spread: ResolvedSpread,
    chapterIndex: number,
  ): boolean {
    return spread.slots.some(
      (slot) => slot.kind === "page" && slot.page.chapterIndex === chapterIndex,
    );
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

  private emitErrorMessage(intent: SpreadIntent, message: string): void {
    this.emit({ type: "error", intent, message });
  }

  private emitException(intent: SpreadIntent, err: unknown): void {
    this.emitErrorMessage(
      intent,
      err instanceof Error ? err.message : String(err),
    );
  }
}
