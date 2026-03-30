import type {
  ContentAnchor,
  PaginationCommand,
  PaginationEvent,
} from "./engine-types";
import type {
  Block,
  FontConfig,
  LayoutTheme,
  Page,
  PageSlice,
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
  private chapterPageOffsets: number[] = [];

  private fontConfig: FontConfig | null = null;
  private viewport = { width: 620, height: 860 };
  private layoutTheme: LayoutTheme | null = null;

  private totalChapters = 0;
  private receivedChapters = 0;
  private initialChapterIndex = 0;
  private initialChapterReceived = false;

  constructor(emit: (event: PaginationEvent) => void) {
    this.emit = emit;
  }

  handleCommand(cmd: PaginationCommand): void {
    try {
      switch (cmd.type) {
        case "init":
          this.init(
            cmd.totalChapters,
            cmd.fontConfig,
            cmd.layoutTheme,
            cmd.viewport,
            cmd.initialChapterIndex,
          );
          break;
        case "addChapter":
          this.addChapter(cmd.chapterIndex, cmd.blocks);
          break;
        case "setFontConfig":
          this.setFontConfig(cmd.fontConfig, cmd.anchor);
          break;
        case "setViewport":
          this.setViewport(cmd.width, cmd.height, cmd.anchor);
          break;
        case "setLayoutTheme":
          this.setLayoutTheme(cmd.layoutTheme, cmd.anchor);
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
    fontConfig: FontConfig,
    layoutTheme: LayoutTheme,
    viewport: { width: number; height: number },
    initialChapterIndex: number,
  ): void {
    this.fontConfig = fontConfig;
    this.layoutTheme = layoutTheme;
    this.viewport = viewport;

    this.totalChapters = Math.max(0, totalChapters);
    this.initialChapterIndex =
      this.totalChapters === 0
        ? 0
        : Math.min(Math.max(initialChapterIndex, 0), this.totalChapters - 1);

    this.blocksByChapter = new Array(this.totalChapters).fill(null);
    this.preparedByChapter = new Array(this.totalChapters).fill(null);
    this.pagesByChapter = new Array(this.totalChapters).fill(null);

    this.receivedChapters = 0;
    this.initialChapterReceived = false;

    this.recomputeOffsets();
  }

  private addChapter(chapterIndex: number, blocks: Block[]): void {
    if (chapterIndex < 0 || chapterIndex >= this.totalChapters) {
      throw new Error(`Chapter index ${chapterIndex} is out of bounds`);
    }

    const hadChapter = this.blocksByChapter[chapterIndex] !== null;
    this.blocksByChapter[chapterIndex] = blocks;

    this.prepareAndLayoutChapter(chapterIndex);
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
      this.emit({
        type: "partialReady",
        chapterIndex,
        chapterPageCount: this.pagesByChapter[chapterIndex]?.length ?? 0,
        estimatedTotalPages: this.estimateTotalPages(),
        anchorPage,
        slices: this.getSlicesForGlobalPage(anchorPage ?? 1),
        chapterPageOffsets: [...this.chapterPageOffsets],
      });

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
      chaptersCompleted: this.receivedChapters,
      totalChapters: this.totalChapters,
      runningTotalPages: this.getTotalPages(),
      chapterPageOffsets: [...this.chapterPageOffsets],
    });
  }

  private setFontConfig(
    fontConfig: FontConfig,
    anchor: ContentAnchor | null,
  ): void {
    this.fontConfig = fontConfig;
    if (this.totalChapters === 0) return;
    if (this.receivedChapters === 0) return;

    const anchorChapter = anchor
      ? anchor.chapterIndex
      : this.initialChapterIndex;
    const validAnchorChapter = Math.min(
      Math.max(anchorChapter, 0),
      this.totalChapters - 1,
    );

    if (this.blocksByChapter[validAnchorChapter]) {
      this.prepareAndLayoutChapter(validAnchorChapter);
      this.recomputeOffsets();

      const anchorPage = anchor
        ? this.resolveAnchor(anchor)
        : (this.getInitialAnchorPage() ?? 1);

      this.emit({
        type: "partialReady",
        chapterIndex: validAnchorChapter,
        chapterPageCount: this.pagesByChapter[validAnchorChapter]?.length ?? 0,
        estimatedTotalPages: this.estimateTotalPages(),
        anchorPage,
        slices: this.getSlicesForGlobalPage(anchorPage ?? 1),
        chapterPageOffsets: [...this.chapterPageOffsets],
      });
    }

    for (let i = 0; i < this.totalChapters; i++) {
      if (i === validAnchorChapter || !this.blocksByChapter[i]) continue;

      this.prepareAndLayoutChapter(i);
      this.recomputeOffsets();

      this.emit({
        type: "progress",
        chaptersCompleted: this.receivedChapters,
        totalChapters: this.totalChapters,
        runningTotalPages: this.getTotalPages(),
        chapterPageOffsets: [...this.chapterPageOffsets],
      });
    }

    this.recomputeOffsets();
    const anchorPage = anchor
      ? this.resolveAnchor(anchor)
      : this.getInitialAnchorPage();

    this.emit({
      type: "ready",
      totalPages: this.getTotalPages(),
      anchorPage,
      slices: this.getSlicesForGlobalPage(anchorPage ?? 1),
      diagnostics: this.buildDiagnostics(),
      chapterPageOffsets: [...this.chapterPageOffsets],
    });
  }

  private setViewport(
    width: number,
    height: number,
    anchor: ContentAnchor | null,
  ): void {
    this.viewport = { width, height };
    this.relayoutAll(anchor);
  }

  private setLayoutTheme(
    layoutTheme: LayoutTheme,
    anchor: ContentAnchor | null,
  ): void {
    this.layoutTheme = layoutTheme;
    this.relayoutAll(anchor);
  }

  private relayoutAll(anchor: ContentAnchor | null): void {
    if (
      !this.layoutTheme ||
      this.totalChapters === 0 ||
      this.receivedChapters === 0
    )
      return;

    for (let i = 0; i < this.totalChapters; i++) {
      const prepared = this.preparedByChapter[i];
      if (!prepared) continue;
      const result = layoutPages(
        prepared,
        this.viewport.width,
        this.viewport.height,
        this.layoutTheme,
      );
      this.pagesByChapter[i] = result.pages;
    }

    this.recomputeOffsets();

    const anchorPage = anchor
      ? this.resolveAnchor(anchor)
      : this.getInitialAnchorPage();

    this.emit({
      type: "ready",
      totalPages: this.getTotalPages(),
      anchorPage,
      slices: this.getSlicesForGlobalPage(anchorPage ?? 1),
      diagnostics: this.buildDiagnostics(),
      chapterPageOffsets: [...this.chapterPageOffsets],
    });
  }

  private getPage(globalPage: number): void {
    this.emit({
      type: "pageContent",
      globalPage,
      slices: this.getSlicesForGlobalPage(globalPage),
    });
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private emitReady(anchorPage: number | null): void {
    this.emit({
      type: "ready",
      totalPages: this.getTotalPages(),
      anchorPage,
      slices: this.getSlicesForGlobalPage(anchorPage ?? 1),
      diagnostics: this.buildDiagnostics(),
      chapterPageOffsets: [...this.chapterPageOffsets],
    });
  }

  private prepareAndLayoutChapter(chapterIndex: number): void {
    if (!this.fontConfig || !this.layoutTheme) return;
    const blocks = this.blocksByChapter[chapterIndex];
    if (!blocks) return;

    const prepared = prepareBlocks(blocks, this.fontConfig);
    this.preparedByChapter[chapterIndex] = prepared;

    const result = layoutPages(
      prepared,
      this.viewport.width,
      this.viewport.height,
      this.layoutTheme,
    );
    this.pagesByChapter[chapterIndex] = result.pages;
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

  private getSlicesForGlobalPage(globalPage: number): PageSlice[] {
    const page1 = Math.max(1, globalPage);
    const pageIndex = page1 - 1;

    for (let ch = this.chapterPageOffsets.length - 1; ch >= 0; ch--) {
      const offset = this.chapterPageOffsets[ch];
      if (offset === undefined) continue;
      if (pageIndex >= offset) {
        const localIndex = pageIndex - offset;
        const pages = this.pagesByChapter[ch];
        if (pages && localIndex < pages.length) {
          return pages[localIndex]?.slices ?? [];
        }
      }
    }

    return [];
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

  private buildDiagnostics(): PaginationDiagnostics {
    let blockCount = 0;
    let lineCount = 0;

    for (const prepared of this.preparedByChapter) {
      if (prepared) blockCount += prepared.length;
    }
    for (const pages of this.pagesByChapter) {
      if (!pages) continue;
      for (const page of pages) {
        for (const slice of page.slices) {
          if (slice.type === "text") lineCount += slice.lines.length;
        }
      }
    }

    return { blockCount, lineCount, computeMs: 0 };
  }
}
