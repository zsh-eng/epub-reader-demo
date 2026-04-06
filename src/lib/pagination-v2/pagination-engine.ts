import { layoutPages } from "./shared/layout-pages";
import { prepareBlocks } from "./shared/prepare-blocks";
import type {
    Block,
    Page,
    PaginationChapterDiagnostics,
    PreparedBlock,
    TextCursorOffset,
} from "./shared/types";
import { areFontConfigsEqual } from "./shared/types";
import type {
    ChapterUnavailableEvent,
    PaginationCommand,
    PaginationEvent,
} from "./engine-types";
import type {
    ContentAnchor,
    PaginationConfig,
    ResolvedLeafPage,
    ResolvedSpread,
    SpreadConfig,
    SpreadGapReason,
} from "./types";
import { DEFAULT_SPREAD_CONFIG } from "./types";

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
// Spread projection types
// ---------------------------------------------------------------------------

type LeafRef = {
  chapterIndex: number;
  localPageIndex: number;
  globalPage: number;
};

type SpreadMapCell =
  | {
      kind: "page";
      leaf: LeafRef;
    }
  | {
      kind: "gap";
      reason: SpreadGapReason;
    };

type SpreadMap = Array<Array<SpreadMapCell>>;

interface SpreadProjection {
  spreadMap: SpreadMap;
  spreadIndexByGlobalPage: Map<number, number>;
}

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

type PaginationCause = PaginationCommand["type"];

// ---------------------------------------------------------------------------
// PaginationEngine
// ---------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Command dispatcher
  // -------------------------------------------------------------------------

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
      }
    } catch (err) {
      this.emit({
        type: "error",
        cause,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Command handlers
  // -------------------------------------------------------------------------

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

    // Establish anchor — use initialAnchor if it resolves, else pick page 0.
    if (initialAnchor) {
      const resolved = this.resolveAnchorToPage(initialAnchor);
      this.anchor = resolved
        ? initialAnchor
        : this.pickAnchorForPage(this.initialChapterIndex, 0);
    } else {
      this.anchor = this.pickAnchorForPage(this.initialChapterIndex, 0);
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

    // Skip if we already have this chapter (e.g. initialChapterIndex from init).
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
          (d): d is PaginationChapterDiagnostics => d !== null,
        ),
      });
    } else {
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
  }

  async updatePaginationConfig(
    cause: "updatePaginationConfig",
    nextConfig: PaginationConfig,
    runtime: Partial<PaginationRuntime> = {},
  ): Promise<void> {
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

    const rt = this.resolveRuntime(runtime);

    if (fontChanged) {
      // A preempted font relayout can otherwise leave a mix of old/new prepared
      // chapters. Clearing loaded prepared chapters ensures any follow-up relayout
      // (even layout-only) will re-prepare missing chapters with the latest font.
      for (let ch = 0; ch < this.totalChapters; ch++) {
        if (!this.blocksByChapter[ch]) continue;
        this.preparedByChapter[ch] = null;
      }
    }

    await this.runRelayout(cause, (ch) => {
      if (!this.blocksByChapter[ch]) return null;

      const prepared = this.preparedByChapter[ch];
      if (!prepared) {
        return this.prepareAndLayoutChapter(ch);
      }

      const stage2PrepareMs =
        this.chapterDiagnosticsByChapter[ch]?.stage2PrepareMs ?? 0;
      return this.layoutPreparedChapter(ch, prepared, stage2PrepareMs);
    }, rt);
  }

  updateSpreadConfig(
    cause: "updateSpreadConfig",
    nextSpreadConfig: SpreadConfig,
  ): void {
    if (this.areSpreadConfigsEqual(this.spreadConfig, nextSpreadConfig)) return;
    this.spreadConfig = nextSpreadConfig;
    if (this.receivedChapters === 0) return;

    // Spread projection is presentation-only. Re-emit the current position
    // immediately without forcing relayout.
    this.emitPageContent(cause);
  }

  nextSpread(cause: "nextSpread"): void {
    const currentSpreadIndex = this.resolveCurrentSpreadIndex();
    if (currentSpreadIndex === null) {
      this.emitPageUnavailable(cause);
      return;
    }

    const nextIndex = currentSpreadIndex + 1;
    if (!this.setAnchorFromSpreadIndex(nextIndex)) {
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

    const prevIndex = currentSpreadIndex - 1;
    if (!this.setAnchorFromSpreadIndex(prevIndex)) {
      this.emitPageUnavailable(cause);
      return;
    }

    this.emitPageContent(cause);
  }

  goToPage(cause: "goToPage", globalPage: number): void {
    const page1 = Math.max(1, Math.floor(globalPage));
    const pageIndex = page1 - 1;

    for (let ch = this.chapterPageOffsets.length - 1; ch >= 0; ch--) {
      const offset = this.chapterPageOffsets[ch];
      if (offset === undefined || pageIndex < offset) continue;

      const localIndex = pageIndex - offset;
      const pages = this.pagesByChapter[ch];
      if (!pages || localIndex >= pages.length) continue;

      this.anchor = this.pickAnchorForPage(ch, localIndex);
      this.emitPageContent(cause);
      return;
    }

    this.emitPageUnavailable(cause);
  }

  goToChapter(cause: "goToChapter", chapterIndex: number): void {
    const ch = Math.floor(chapterIndex);
    if (ch < 0 || ch >= this.totalChapters) {
      const event: ChapterUnavailableEvent = {
        type: "chapterUnavailable",
        cause,
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
        cause,
        epoch: this.epoch,
        chapterIndex: ch,
      };
      this.emit(event);
      return;
    }

    this.anchor = this.pickAnchorForPage(ch, 0);
    this.emitPageContent(cause);
  }

  // -------------------------------------------------------------------------
  // Relayout
  // -------------------------------------------------------------------------

  private async runRelayout(
    cause: PaginationCause,
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

      // TODO: Remove this nullish coalescing?
      // Doesn't seem to be useful
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
          chapterDiagnostics: diag,
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
          chapterDiagnostics: diag,
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

  private get totalSpreads(): number {
    return Math.max(1, this.spreadProjection.spreadMap.length);
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
      return {
        chapterIndex: anchor.chapterIndex,
        localPageIndex: nearestPrecedingPage,
      };
    }
    if (firstBlockPage !== null) {
      return {
        chapterIndex: anchor.chapterIndex,
        localPageIndex: firstBlockPage,
      };
    }
    // Block not found — fall back to chapter start.
    return { chapterIndex: anchor.chapterIndex, localPageIndex: 0 };
  }

  private resolveAnchorToGlobalPage(anchor: ContentAnchor): number | null {
    const resolved = this.resolveAnchorToPage(anchor);
    if (!resolved) return null;

    const offset = this.chapterPageOffsets[resolved.chapterIndex] ?? 0;
    return offset + resolved.localPageIndex + 1;
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

    // Spacers are not meaningful anchors: a spacer's blockId is often shared
    // with the image that follows it (both come from the same block in the
    // source), so anchoring to a spacer causes resolveAnchorToPage to find
    // the wrong page when two slices share the same blockId.
    const anchorableSlices = page.slices.filter((s) => s.type !== "spacer");
    const slices = anchorableSlices.length > 0 ? anchorableSlices : page.slices;

    const midSlice = slices[Math.floor(slices.length / 2)];
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

  private resolveCurrentSpreadIndex(): number | null {
    const anchorGlobalPage = this.resolveAnchorToGlobalPage(this.anchor);
    if (anchorGlobalPage === null) return null;

    const spreadIndex =
      this.spreadProjection.spreadIndexByGlobalPage.get(anchorGlobalPage);
    if (spreadIndex === undefined) return null;
    return spreadIndex;
  }

  private setAnchorFromSpreadIndex(spreadIndex: number): boolean {
    const { spreadMap } = this.spreadProjection;
    if (spreadIndex < 0 || spreadIndex >= spreadMap.length) {
      return false;
    }

    const spread = spreadMap[spreadIndex];
    if (!spread) return false;

    const firstPageCell = spread.find(
      (cell): cell is Extract<SpreadMapCell, { kind: "page" }> =>
        cell.kind === "page",
    );
    if (!firstPageCell) return false;

    this.anchor = this.pickAnchorForPage(
      firstPageCell.leaf.chapterIndex,
      firstPageCell.leaf.localPageIndex,
    );
    return true;
  }

  // -------------------------------------------------------------------------
  // Spread projection
  // -------------------------------------------------------------------------

  private buildResolvedSpread(cause: PaginationCause): ResolvedSpread | null {
    const anchorGlobalPage = this.resolveAnchorToGlobalPage(this.anchor);
    if (anchorGlobalPage === null) return null;

    const projection = this.spreadProjection;
    const spreadIndex =
      projection.spreadIndexByGlobalPage.get(anchorGlobalPage);
    if (spreadIndex === undefined) return null;

    const spread = projection.spreadMap[spreadIndex];
    if (!spread) return null;

    const slots = spread.map((cell, slotIndex) => {
      if (cell.kind === "page") {
        return {
          kind: "page" as const,
          slotIndex,
          page: this.buildResolvedLeafPage(cell.leaf),
        };
      }
      return {
        kind: "gap" as const,
        slotIndex,
        reason: cell.reason,
      };
    });

    const pageSlots = slots.filter(
      (slot): slot is Extract<(typeof slots)[number], { kind: "page" }> =>
        slot.kind === "page",
    );
    const firstVisiblePage = pageSlots[0]?.page.currentPage ?? anchorGlobalPage;

    const chapterIndexStart = pageSlots[0]?.page.chapterIndex ?? null;
    const chapterIndexEnd =
      pageSlots[pageSlots.length - 1]?.page.chapterIndex ?? null;

    return {
      slots,
      cause,
      currentPage: firstVisiblePage,
      totalPages: this.totalPages,
      currentSpread: spreadIndex + 1,
      totalSpreads: this.totalSpreads,
      chapterIndexStart,
      chapterIndexEnd,
    };
  }

  private buildResolvedLeafPage(leaf: LeafRef): ResolvedLeafPage {
    const pages = this.pagesByChapter[leaf.chapterIndex] ?? [];
    const page = pages[leaf.localPageIndex];

    return {
      currentPage: leaf.globalPage,
      totalPages: this.totalPages,
      currentPageInChapter: leaf.localPageIndex + 1,
      totalPagesInChapter: pages.length,
      chapterIndex: leaf.chapterIndex,
      content: page?.slices ?? [],
    };
  }

  private get spreadProjection(): SpreadProjection {
    const spreadMap = this.buildSpreadMap();

    const spreadIndexByGlobalPage = new Map<number, number>();
    for (let spreadIndex = 0; spreadIndex < spreadMap.length; spreadIndex++) {
      const spread = spreadMap[spreadIndex];
      if (!spread) continue;
      for (const cell of spread) {
        if (cell.kind !== "page") continue;
        spreadIndexByGlobalPage.set(cell.leaf.globalPage, spreadIndex);
      }
    }

    return {
      spreadMap,
      spreadIndexByGlobalPage,
    };
  }

  private buildSpreadMap(): SpreadMap {
    const { columns, chapterFlow } = this.spreadConfig;
    const offsets = this.chapterPageOffsets;

    const chapterLeaves: LeafRef[][] = [];
    for (let chapterIndex = 0; chapterIndex < this.totalChapters; chapterIndex++) {
      const pages = this.pagesByChapter[chapterIndex] ?? [];
      const offset = offsets[chapterIndex] ?? 0;
      const leaves = pages.map((_, localPageIndex) => ({
        chapterIndex,
        localPageIndex,
        globalPage: offset + localPageIndex + 1,
      }));
      chapterLeaves.push(leaves);
    }

    const spreads: SpreadMap = [];
    let currentSpread: SpreadMapCell[] = [];

    const pushCell = (cell: SpreadMapCell) => {
      currentSpread.push(cell);
      if (currentSpread.length >= columns) {
        spreads.push(currentSpread);
        currentSpread = [];
      }
    };

    const flushWithGap = (reason: SpreadGapReason) => {
      if (currentSpread.length === 0) return;
      while (currentSpread.length < columns) {
        currentSpread.push({ kind: "gap", reason });
      }
      spreads.push(currentSpread);
      currentSpread = [];
    };

    if (chapterFlow === "continuous") {
      for (let chapterIndex = 0; chapterIndex < this.totalChapters; chapterIndex++) {
        for (const leaf of chapterLeaves[chapterIndex] ?? []) {
          pushCell({ kind: "page", leaf });
        }
      }

      if (currentSpread.length > 0) {
        flushWithGap(this.isFullyLoaded() ? "end-of-book" : "unloaded");
      }
    } else {
      for (let chapterIndex = 0; chapterIndex < this.totalChapters; chapterIndex++) {
        const leaves = chapterLeaves[chapterIndex] ?? [];
        if (leaves.length === 0) continue;

        // Force chapter starts to the leftmost slot.
        if (currentSpread.length > 0) {
          flushWithGap("chapter-boundary");
        }

        for (const leaf of leaves) {
          pushCell({ kind: "page", leaf });
        }

        // Keep the following chapter left-aligned, if any chapter remains.
        if (chapterIndex < this.totalChapters - 1 && currentSpread.length > 0) {
          flushWithGap("chapter-boundary");
        }
      }

      if (currentSpread.length > 0) {
        flushWithGap(this.isFullyLoaded() ? "end-of-book" : "unloaded");
      }
    }

    if (spreads.length === 0) {
      const reason: SpreadGapReason = this.isFullyLoaded()
        ? "end-of-book"
        : "unloaded";
      spreads.push(
        Array.from({ length: columns }, () => ({ kind: "gap", reason })),
      );
    }

    return spreads;
  }

  private isFullyLoaded(): boolean {
    return this.receivedChapters === this.totalChapters;
  }

  // -------------------------------------------------------------------------
  // Emit helpers
  // -------------------------------------------------------------------------

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
  // Config equality and normalization
  // -------------------------------------------------------------------------

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
    for (let ch = 0; ch < this.totalChapters; ch++) {
      if (!this.blocksByChapter[ch]) continue;
      if (!this.preparedByChapter[ch]) return false;
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
