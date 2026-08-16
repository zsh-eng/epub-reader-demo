import {
  BOOK_COVER_TILE_ID,
  BOOK_DETAILS_TILE_ID,
  computeJustifiedHighlightsMosaicLayout,
  getHighlightsMosaicGeometry,
} from "@/lib/highlights-masonry-layout";
import { describe, expect, it } from "vitest";

describe("getHighlightsMosaicGeometry", () => {
  it("adds a column only when every card can keep its minimum width", () => {
    const threeColumns = getHighlightsMosaicGeometry(915);
    const fourColumns = getHighlightsMosaicGeometry(916);

    expect(threeColumns.columnCount).toBe(3);
    expect(threeColumns.columnWidth).toBe(297);
    expect(fourColumns.columnCount).toBe(4);
    expect(fourColumns.columnWidth).toBe(220);
  });

  it("scales the book cover with the available horizontal space", () => {
    expect(getHighlightsMosaicGeometry(1_000).coverWidth).toBe(180);
    expect(getHighlightsMosaicGeometry(1_500).coverWidth).toBe(270);
    expect(getHighlightsMosaicGeometry(1_800).coverWidth).toBe(280);
  });
});

describe("computeJustifiedHighlightsMosaicLayout", () => {
  it("places the book details, standalone cover, and highlights together", () => {
    const mosaic = computeJustifiedHighlightsMosaicLayout(
      1_000,
      [
        { id: "a", height: 160 },
        { id: "b", height: 100 },
        { id: "c", height: 140 },
        { id: "d", height: 120 },
        { id: "e", height: 180 },
        { id: "f", height: 110 },
        { id: "g", height: 150 },
        { id: "h", height: 130 },
      ],
      { detailsHeight: 180 },
    );

    expect(mosaic.placements).toHaveLength(10);
    expect(
      mosaic.placements.find(({ id }) => id === BOOK_DETAILS_TILE_ID),
    ).toMatchObject({ kind: "details", column: 0, top: 0 });
    expect(
      mosaic.placements.filter(({ kind }) => kind === "highlight"),
    ).toHaveLength(8);

    const cover = mosaic.placements.find(({ id }) => id === BOOK_COVER_TILE_ID);
    expect(cover).toMatchObject({
      kind: "cover",
      column: mosaic.coverColumn,
      width: mosaic.coverWidth,
    });

    const coverColumn = mosaic.placements
      .filter(({ column }) => column === mosaic.coverColumn)
      .sort((left, right) => left.top - right.top);
    const coverIndex = coverColumn.findIndex(
      ({ id }) => id === BOOK_COVER_TILE_ID,
    );
    expect(coverColumn[coverIndex - 1]?.kind).toBe("highlight");
    expect(coverColumn[coverIndex + 1]?.kind).toBe("highlight");
  });

  it("stretches quote cards so every populated column has one bottom edge", () => {
    const mosaic = computeJustifiedHighlightsMosaicLayout(
      1_000,
      [
        { id: "a", height: 160 },
        { id: "b", height: 100 },
        { id: "c", height: 140 },
        { id: "d", height: 120 },
        { id: "e", height: 180 },
        { id: "f", height: 110 },
        { id: "g", height: 150 },
        { id: "h", height: 130 },
      ],
      { detailsHeight: 180 },
    );

    const columnBottoms = Array.from(
      { length: mosaic.columnCount },
      (_, column) =>
        Math.max(
          ...mosaic.placements
            .filter((placement) => placement.column === column)
            .map((placement) => placement.top + placement.height),
        ),
    );

    for (const bottom of columnBottoms) {
      expect(bottom).toBeCloseTo(mosaic.height);
    }
    for (const placement of mosaic.placements) {
      expect(placement.height).toBeGreaterThanOrEqual(placement.naturalHeight);
    }
  });

  it("returns an empty layout before the container is measured", () => {
    expect(
      computeJustifiedHighlightsMosaicLayout(0, [{ id: "a", height: 100 }]),
    ).toEqual({
      columnCount: 1,
      columnWidth: 0,
      coverColumn: 0,
      coverWidth: 0,
      height: 0,
      placements: [],
    });
  });
});
