import {
  getDefaultPaginatedReaderLayout,
  resolvePaginatedReaderLayout,
} from "@/components/Reader/hooks/use-paginated-reader-layout";
import { describe, expect, it } from "vitest";

describe("resolvePaginatedReaderLayout", () => {
  it("starts from a conservative single-page default before the stage is measured", () => {
    const layout = getDefaultPaginatedReaderLayout();

    expect(layout.resolvedSpreadColumns).toBe(1);
  });

  it("bases vertical padding on hover rail heights instead of chrome height", () => {
    const layout = getDefaultPaginatedReaderLayout();

    expect(layout.stagePadding.paddingTop).toBeGreaterThan(layout.topRailHeight);
    expect(layout.stagePadding.paddingBottom).toBeGreaterThan(
      layout.bottomRailHeight,
    );
    expect(layout.stagePadding.paddingTop - layout.topRailHeight).toBe(
      layout.stagePadding.paddingBottom - layout.bottomRailHeight,
    );
  });

  it("keeps mobile in single-page mode even on wide stages", () => {
    const layout = resolvePaginatedReaderLayout({
      stageWidth: 1440,
      stageHeight: 900,
      isMobile: true,
    });

    expect(layout.resolvedSpreadColumns).toBe(1);
  });

  it("switches desktop to a spread once two narrow pages fit comfortably", () => {
    const layout = resolvePaginatedReaderLayout({
      stageWidth: 1024,
      stageHeight: 900,
      isMobile: false,
    });

    expect(layout.resolvedSpreadColumns).toBe(2);
    expect(layout.columnGapPx).toBeGreaterThan(20);
    expect(layout.stageViewport.width).toBeGreaterThanOrEqual(420);
  });

  it("falls back to single-page when a spread would be cramped", () => {
    const layout = resolvePaginatedReaderLayout({
      stageWidth: 980,
      stageHeight: 900,
      isMobile: false,
    });

    expect(layout.resolvedSpreadColumns).toBe(1);
  });

  it("adds extra desktop width to outer margins once spread measure is satisfied", () => {
    const mediumStage = resolvePaginatedReaderLayout({
      stageWidth: 1200,
      stageHeight: 900,
      isMobile: false,
    });
    const wideStage = resolvePaginatedReaderLayout({
      stageWidth: 1500,
      stageHeight: 900,
      isMobile: false,
    });

    expect(mediumStage.resolvedSpreadColumns).toBe(2);
    expect(wideStage.resolvedSpreadColumns).toBe(2);
    expect(wideStage.stageViewport.width).toBe(mediumStage.stageViewport.width);
    expect(wideStage.stagePadding.paddingX).toBeGreaterThan(
      mediumStage.stagePadding.paddingX,
    );
  });
});
