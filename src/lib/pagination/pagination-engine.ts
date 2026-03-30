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

  private blocksByChapter: Block[][] = [];
  private preparedByChapter: (PreparedBlock[] | null)[] = [];
  private pagesByChapter: (Page[] | null)[] = [];
  private chapterPageOffsets: number[] = [];

  private fontConfig: FontConfig | null = null;
  private viewport = { width: 620, height: 860 };
  private layoutTheme: LayoutTheme | null = null;

  constructor(emit: (event: PaginationEvent) => void) {
    this.emit = emit;
  }

  handleCommand(cmd: PaginationCommand): void {
    try {
      switch (cmd.type) {
        case "load":
          this.load(cmd.blocksByChapter, cmd.fontConfig, cmd.layoutTheme, cmd.viewport, cmd.initialChapterIndex ?? 0);
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

  private load(
    blocksByChapter: Block[][],
    fontConfig: FontConfig,
    layoutTheme: LayoutTheme,
    viewport: { width: number; height: number },
    initialChapterIndex: number,
  ): void {
    this.blocksByChapter = blocksByChapter;
    this.fontConfig = fontConfig;
    this.layoutTheme = layoutTheme;
    this.viewport = viewport;

    const chapterCount = blocksByChapter.length;
    this.preparedByChapter = new Array(chapterCount).fill(null);
    this.pagesByChapter = new Array(chapterCount).fill(null);

    if (chapterCount === 0) {
      this.recomputeOffsets();
      this.emit({
        type: "ready",
        totalPages: 1,
        anchorPage: null,
        slices: [],
        diagnostics: { blockCount: 0, lineCount: 0, computeMs: 0 },
        chapterPageOffsets: [],
      });
      return;
    }

    // Progressive: prepare the initial chapter first so the UI has content immediately
    const anchorChapter = Math.min(initialChapterIndex, chapterCount - 1);
    this.prepareAndLayoutChapter(anchorChapter);
    this.recomputeOffsets();

    const anchorPage = (this.chapterPageOffsets[anchorChapter] ?? 0) + 1;
    const estimatedTotal = this.estimateTotalPages(anchorChapter);

    this.emit({
      type: "partialReady",
      chapterIndex: anchorChapter,
      chapterPageCount: this.pagesByChapter[anchorChapter]?.length ?? 0,
      estimatedTotalPages: estimatedTotal,
      anchorPage,
      slices: this.getSlicesForGlobalPage(anchorPage),
      chapterPageOffsets: [...this.chapterPageOffsets],
    });

    // Prepare remaining chapters
    for (let i = 0; i < chapterCount; i++) {
      if (i === anchorChapter) continue;
      this.prepareAndLayoutChapter(i);
      this.recomputeOffsets();

      this.emit({
        type: "progress",
        chaptersCompleted: this.countPreparedChapters(),
        totalChapters: chapterCount,
        runningTotalPages: this.getTotalPages(),
        chapterPageOffsets: [...this.chapterPageOffsets],
      });
    }

    this.recomputeOffsets();

    this.emit({
      type: "ready",
      totalPages: this.getTotalPages(),
      anchorPage,
      slices: this.getSlicesForGlobalPage(anchorPage),
      diagnostics: this.buildDiagnostics(),
      chapterPageOffsets: [...this.chapterPageOffsets],
    });
  }

  private setFontConfig(fontConfig: FontConfig, anchor: ContentAnchor | null): void {
    this.fontConfig = fontConfig;
    const chapterCount = this.blocksByChapter.length;
    if (chapterCount === 0) return;

    // Progressive re-preparation: anchor chapter first
    const anchorChapter = anchor ? anchor.chapterIndex : 0;
    const validAnchorChapter = Math.min(anchorChapter, chapterCount - 1);

    this.prepareAndLayoutChapter(validAnchorChapter);
    this.recomputeOffsets();

    const anchorPage = anchor ? this.resolveAnchor(anchor) : 1;
    const estimatedTotal = this.estimateTotalPages(validAnchorChapter);

    this.emit({
      type: "partialReady",
      chapterIndex: validAnchorChapter,
      chapterPageCount: this.pagesByChapter[validAnchorChapter]?.length ?? 0,
      estimatedTotalPages: estimatedTotal,
      anchorPage,
      slices: this.getSlicesForGlobalPage(anchorPage ?? 1),
      chapterPageOffsets: [...this.chapterPageOffsets],
    });

    // Prepare remaining chapters
    for (let i = 0; i < chapterCount; i++) {
      if (i === validAnchorChapter) continue;
      this.prepareAndLayoutChapter(i);
      this.recomputeOffsets();

      this.emit({
        type: "progress",
        chaptersCompleted: this.countPreparedChapters(),
        totalChapters: chapterCount,
        runningTotalPages: this.getTotalPages(),
        chapterPageOffsets: [...this.chapterPageOffsets],
      });
    }

    this.recomputeOffsets();
    const totalPages = this.getTotalPages();
    const finalAnchorPage = anchor ? this.resolveAnchor(anchor) : 1;

    this.emit({
      type: "ready",
      totalPages,
      anchorPage: finalAnchorPage,
      slices: this.getSlicesForGlobalPage(finalAnchorPage ?? 1),
      diagnostics: this.buildDiagnostics(),
      chapterPageOffsets: [...this.chapterPageOffsets],
    });
  }

  private setViewport(width: number, height: number, anchor: ContentAnchor | null): void {
    this.viewport = { width, height };
    this.relayoutAll(anchor);
  }

  private setLayoutTheme(layoutTheme: LayoutTheme, anchor: ContentAnchor | null): void {
    this.layoutTheme = layoutTheme;
    this.relayoutAll(anchor);
  }

  private relayoutAll(anchor: ContentAnchor | null): void {
    if (!this.layoutTheme) return;

    for (let i = 0; i < this.blocksByChapter.length; i++) {
      const prepared = this.preparedByChapter[i];
      if (!prepared) continue;
      const result = layoutPages(prepared, this.viewport.width, this.viewport.height, this.layoutTheme);
      this.pagesByChapter[i] = result.pages;
    }

    this.recomputeOffsets();
    const totalPages = this.getTotalPages();
    const anchorPage = anchor ? this.resolveAnchor(anchor) : null;

    this.emit({
      type: "ready",
      totalPages,
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

  private prepareAndLayoutChapter(chapterIndex: number): void {
    if (!this.fontConfig || !this.layoutTheme) return;
    const blocks = this.blocksByChapter[chapterIndex];
    if (!blocks) return;

    const prepared = prepareBlocks(blocks, this.fontConfig);
    this.preparedByChapter[chapterIndex] = prepared;

    const result = layoutPages(prepared, this.viewport.width, this.viewport.height, this.layoutTheme);
    this.pagesByChapter[chapterIndex] = result.pages;
  }

  private recomputeOffsets(): void {
    const offsets: number[] = [];
    let running = 0;
    for (let i = 0; i < this.pagesByChapter.length; i++) {
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

  private countPreparedChapters(): number {
    let count = 0;
    for (const p of this.preparedByChapter) {
      if (p !== null) count++;
    }
    return count;
  }

  private estimateTotalPages(preparedChapterIndex: number): number {
    const chapterPages = this.pagesByChapter[preparedChapterIndex]?.length ?? 0;
    const chapterBlocks = this.blocksByChapter[preparedChapterIndex]?.length ?? 1;
    if (chapterBlocks === 0) return chapterPages;

    const pagesPerBlock = chapterPages / chapterBlocks;
    let totalBlocks = 0;
    for (const ch of this.blocksByChapter) {
      totalBlocks += ch.length;
    }
    return Math.max(1, Math.round(pagesPerBlock * totalBlocks));
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
