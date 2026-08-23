import {
  BOOK_COVER_TILE_ID,
  BOOK_DETAILS_TILE_ID,
  computeHighlightsBentoLayout,
  getHighlightsMosaicGeometry,
  type MosaicPlacement,
} from "@/lib/highlights-masonry-layout";
import { describe, expect, it } from "vitest";

function placementsOverlap(left: MosaicPlacement, right: MosaicPlacement) {
  const horizontalOverlap =
    left.column < right.column + right.columnSpan &&
    right.column < left.column + left.columnSpan;
  const verticalOverlap =
    left.top < right.top + right.height && right.top < left.top + left.height;
  return horizontalOverlap && verticalOverlap;
}

describe("getHighlightsMosaicGeometry", () => {
  it("adds a column only when every card can keep its minimum width", () => {
    const threeColumns = getHighlightsMosaicGeometry(903);
    const fourColumns = getHighlightsMosaicGeometry(904);

    expect(threeColumns.columnCount).toBe(3);
    expect(threeColumns.columnWidth).toBeCloseTo(295.67, 1);
    expect(fourColumns.columnCount).toBe(4);
    expect(fourColumns.columnWidth).toBe(220);
  });

  it("makes a one-column book cover fill its full column", () => {
    const geometry = getHighlightsMosaicGeometry(1_000);

    expect(geometry.coverWidth).toBe(geometry.columnWidth);
  });
});

describe("computeHighlightsBentoLayout", () => {
  it("combines the book details and cover when only one column is available", () => {
    const mosaic = computeHighlightsBentoLayout(
      360,
      [{ id: "a", height: 160 }],
      { detailsHeight: 180 },
    );
    const detailsPlacement = mosaic.placements.find(
      ({ id }) => id === BOOK_DETAILS_TILE_ID,
    );

    expect(mosaic.columnCount).toBe(1);
    expect(
      mosaic.placements.find(({ id }) => id === BOOK_COVER_TILE_ID),
    ).toBeUndefined();
    expect(detailsPlacement).toMatchObject({
      kind: "details",
      column: 0,
      top: 0,
      columnSpan: 1,
    });
    expect(mosaic.placements.find(({ id }) => id === "a")?.top).toBeGreaterThan(
      detailsPlacement?.top ?? 0,
    );
  });

  it("nests the cover and lets a long quote span two columns", () => {
    const mosaic = computeHighlightsBentoLayout(
      1_000,
      [
        { id: "a", height: 160 },
        { id: "b", height: 100 },
        {
          id: "long",
          height: 260,
          wideHeight: 150,
          preferredColumnSpan: 2,
        },
        { id: "d", height: 120 },
        { id: "e", height: 180 },
        { id: "f", height: 110 },
        { id: "g", height: 150 },
        { id: "h", height: 130 },
      ],
      { detailsHeight: 180, layoutSeed: 7 },
    );

    expect(
      mosaic.placements.filter(({ kind }) => kind !== "filler"),
    ).toHaveLength(10);
    expect(
      mosaic.placements.find(({ id }) => id === BOOK_DETAILS_TILE_ID),
    ).toMatchObject({ kind: "details", column: 0, top: 0, columnSpan: 1 });
    expect(
      mosaic.placements.find(({ id }) => id === BOOK_COVER_TILE_ID),
    ).toMatchObject({ kind: "cover", columnSpan: 1 });
    expect(
      mosaic.placements.find(({ id }) => id === BOOK_COVER_TILE_ID)?.top,
    ).toBeGreaterThan(0);
    expect(mosaic.placements.find(({ id }) => id === "long")).toMatchObject({
      columnSpan: 2,
      naturalHeight: 150,
    });
  });

  it("keeps a low-density cover to one column beside the book details", () => {
    const items = [
      { id: "a", height: 160 },
      { id: "b", height: 120 },
      { id: "c", height: 140 },
    ];
    const mosaic = computeHighlightsBentoLayout(1_000, items, {
      detailsHeight: 180,
    });
    const alternateMosaic = computeHighlightsBentoLayout(1_000, items, {
      detailsHeight: 180,
      layoutSeed: 1,
    });

    expect(
      mosaic.placements.find(({ id }) => id === BOOK_DETAILS_TILE_ID),
    ).toMatchObject({ column: 0, top: 0 });
    expect(
      mosaic.placements.find(({ id }) => id === BOOK_COVER_TILE_ID),
    ).toMatchObject({ column: 1, columnSpan: 1, top: 0 });
    expect(
      alternateMosaic.placements.find(({ id }) => id === BOOK_COVER_TILE_ID),
    ).toMatchObject({ column: 2, columnSpan: 1, top: 0 });
    expect(mosaic.coverWidth).toBeCloseTo(244, 1);
    expect(mosaic.coverWidth).toBe(
      mosaic.placements.find(({ id }) => id === BOOK_COVER_TILE_ID)?.width,
    );
    expect(
      mosaic.placements.find(({ id }) => id === BOOK_COVER_TILE_ID)?.height,
    ).toBeGreaterThan(360);
  });

  it("fills interior holes without extending the content boundary", () => {
    const mosaic = computeHighlightsBentoLayout(
      1_000,
      [
        { id: "a", height: 160 },
        { id: "b", height: 104 },
        { id: "c", height: 260, wideHeight: 140, preferredColumnSpan: 2 },
        { id: "d", height: 128 },
        { id: "e", height: 192 },
      ],
      { detailsHeight: 180, layoutSeed: 2 },
    );
    const contentPlacements = mosaic.placements.filter(
      ({ kind }) => kind !== "filler",
    );
    const fillerPlacements = mosaic.placements.filter(
      ({ kind }) => kind === "filler",
    );

    expect(fillerPlacements.length).toBeGreaterThan(0);
    expect(mosaic.height).toBe(
      Math.max(
        ...contentPlacements.map(
          (placement) => placement.top + placement.height,
        ),
      ),
    );
    expect(
      fillerPlacements.every(
        (placement) => placement.top + placement.height <= mosaic.height,
      ),
    ).toBe(true);
  });

  it("packs every tile without overlap and reports the true bottom edge", () => {
    const mosaic = computeHighlightsBentoLayout(
      1_000,
      [
        { id: "a", height: 160 },
        { id: "b", height: 100 },
        { id: "c", height: 140, wideHeight: 100, preferredColumnSpan: 2 },
        { id: "d", height: 120 },
        { id: "e", height: 180 },
        { id: "f", height: 110 },
        { id: "g", height: 150 },
      ],
      { detailsHeight: 180, layoutSeed: 3 },
    );

    for (const [index, placement] of mosaic.placements.entries()) {
      expect(placement.column + placement.columnSpan).toBeLessThanOrEqual(
        mosaic.columnCount,
      );

      for (const other of mosaic.placements.slice(index + 1)) {
        expect(placementsOverlap(placement, other)).toBe(false);
      }
    }

    expect(mosaic.height).toBe(
      Math.max(
        ...mosaic.placements.map(
          (placement) => placement.top + placement.height,
        ),
      ),
    );
  });

  it("returns an empty layout before the container is measured", () => {
    expect(computeHighlightsBentoLayout(0, [{ id: "a", height: 100 }])).toEqual(
      {
        columnCount: 1,
        columnWidth: 0,
        coverColumn: 0,
        coverColumnSpan: 1,
        coverWidth: 0,
        height: 0,
        placements: [],
      },
    );
  });
});
