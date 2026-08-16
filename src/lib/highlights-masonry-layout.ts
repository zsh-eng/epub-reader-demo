export const BOOK_COVER_TILE_ID = "book-cover";
export const BOOK_DETAILS_TILE_ID = "book-details";

export interface MosaicItemMeasurement {
  id: string;
  height: number;
}

export type MosaicTileKind = "cover" | "details" | "highlight";

export interface MosaicPlacement {
  id: string;
  kind: MosaicTileKind;
  column: number;
  left: number;
  top: number;
  width: number;
  height: number;
  naturalHeight: number;
}

export interface HighlightsMosaicLayout {
  columnCount: number;
  columnWidth: number;
  coverColumn: number;
  coverWidth: number;
  height: number;
  placements: MosaicPlacement[];
}

export interface HighlightsMosaicLayoutOptions {
  gap: number;
  maxColumnCount: number;
  minColumnWidth: number;
  coverAspectRatio: number;
  coverWidthRatio: number;
  maxCoverWidth: number;
  minCoverWidth: number;
  detailsHeight: number;
}

const DEFAULT_OPTIONS: HighlightsMosaicLayoutOptions = {
  gap: 12,
  maxColumnCount: 4,
  minColumnWidth: 220,
  coverAspectRatio: 1.5,
  coverWidthRatio: 0.18,
  maxCoverWidth: 280,
  minCoverWidth: 160,
  detailsHeight: 210,
};

export function getHighlightsMosaicGeometry(
  containerWidth: number,
  options: Partial<HighlightsMosaicLayoutOptions> = {},
): Pick<HighlightsMosaicLayout, "columnCount" | "columnWidth" | "coverWidth"> {
  const {
    coverWidthRatio,
    gap,
    maxColumnCount,
    maxCoverWidth,
    minColumnWidth,
    minCoverWidth,
  } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  if (containerWidth <= 0) {
    return { columnCount: 1, columnWidth: 0, coverWidth: 0 };
  }

  const columnCount = Math.max(
    1,
    Math.min(
      maxColumnCount,
      Math.floor((containerWidth + gap) / (minColumnWidth + gap)),
    ),
  );

  const columnWidth = (containerWidth - gap * (columnCount - 1)) / columnCount;
  const coverWidth = Math.min(
    columnWidth,
    maxCoverWidth,
    Math.max(minCoverWidth, containerWidth * coverWidthRatio),
  );

  return { columnCount, columnWidth, coverWidth };
}

interface ColumnTile {
  id: string;
  kind: MosaicTileKind;
  naturalHeight: number;
}

interface MosaicColumn {
  naturalHeight: number;
  tiles: ColumnTile[];
}

function addTile(column: MosaicColumn, tile: ColumnTile, gap: number) {
  if (column.tiles.length > 0) column.naturalHeight += gap;
  column.tiles.push(tile);
  column.naturalHeight += tile.naturalHeight;
}

function getShortestColumnIndex(columns: MosaicColumn[]) {
  let shortestColumn = 0;

  for (let column = 1; column < columns.length; column += 1) {
    if (columns[column].naturalHeight < columns[shortestColumn].naturalHeight) {
      shortestColumn = column;
    }
  }

  return shortestColumn;
}

/**
 * Builds a dense mosaic around the book details and standalone cover. Quote
 * cards absorb unused height so all populated columns share one bottom edge.
 */
export function computeJustifiedHighlightsMosaicLayout(
  containerWidth: number,
  items: MosaicItemMeasurement[],
  options: Partial<HighlightsMosaicLayoutOptions> = {},
): HighlightsMosaicLayout {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const { coverAspectRatio, gap, detailsHeight } = resolvedOptions;
  const { columnCount, columnWidth, coverWidth } = getHighlightsMosaicGeometry(
    containerWidth,
    resolvedOptions,
  );
  const coverColumn = Math.min(columnCount - 1, Math.floor(columnCount / 2));

  if (containerWidth <= 0) {
    return {
      columnCount,
      columnWidth,
      coverColumn,
      coverWidth,
      height: 0,
      placements: [],
    };
  }

  const columns = Array.from(
    { length: columnCount },
    (): MosaicColumn => ({
      naturalHeight: 0,
      tiles: [],
    }),
  );
  addTile(
    columns[0],
    {
      id: BOOK_DETAILS_TILE_ID,
      kind: "details",
      naturalHeight: detailsHeight,
    },
    gap,
  );

  const [highlightAboveCover, highlightBelowCover, ...remainingItems] = items;
  if (highlightAboveCover) {
    addTile(
      columns[coverColumn],
      {
        id: highlightAboveCover.id,
        kind: "highlight",
        naturalHeight: highlightAboveCover.height,
      },
      gap,
    );
  }
  addTile(
    columns[coverColumn],
    {
      id: BOOK_COVER_TILE_ID,
      kind: "cover",
      naturalHeight: coverWidth * coverAspectRatio,
    },
    gap,
  );
  if (highlightBelowCover) {
    addTile(
      columns[coverColumn],
      {
        id: highlightBelowCover.id,
        kind: "highlight",
        naturalHeight: highlightBelowCover.height,
      },
      gap,
    );
  }

  for (const item of remainingItems) {
    const column = getShortestColumnIndex(columns);
    addTile(
      columns[column],
      {
        id: item.id,
        kind: "highlight",
        naturalHeight: item.height,
      },
      gap,
    );
  }

  const targetHeight = Math.max(
    ...columns.map((column) => column.naturalHeight),
  );
  const placements: MosaicPlacement[] = [];

  columns.forEach((column, columnIndex) => {
    const quoteTiles = column.tiles.filter((tile) => tile.kind === "highlight");
    const quoteHeight = quoteTiles.reduce(
      (total, tile) => total + tile.naturalHeight,
      0,
    );
    const slack =
      quoteTiles.length > 0 ? targetHeight - column.naturalHeight : 0;
    const lastQuoteId = quoteTiles.at(-1)?.id;
    let allocatedSlack = 0;
    let top = 0;

    column.tiles.forEach((tile, tileIndex) => {
      let extraHeight = 0;
      if (tile.kind === "highlight" && slack > 0) {
        extraHeight =
          tile.id === lastQuoteId
            ? slack - allocatedSlack
            : slack * (tile.naturalHeight / quoteHeight);
        allocatedSlack += extraHeight;
      }

      const height = tile.naturalHeight + extraHeight;
      const width = tile.kind === "cover" ? coverWidth : columnWidth;
      placements.push({
        id: tile.id,
        kind: tile.kind,
        column: columnIndex,
        left:
          columnIndex * (columnWidth + gap) +
          (tile.kind === "cover" ? (columnWidth - coverWidth) / 2 : 0),
        top,
        width,
        height,
        naturalHeight: tile.naturalHeight,
      });
      top += height;
      if (tileIndex < column.tiles.length - 1) top += gap;
    });
  });

  return {
    columnCount,
    columnWidth,
    coverColumn,
    coverWidth,
    height: targetHeight,
    placements,
  };
}
