export const BOOK_COVER_TILE_ID = "book-cover";
export const BOOK_DETAILS_TILE_ID = "book-details";

export interface MosaicItemMeasurement {
  id: string;
  height: number;
  wideHeight?: number;
  preferredColumnSpan?: 1 | 2;
}

export type MosaicTileKind = "cover" | "details" | "highlight";

export interface MosaicPlacement {
  id: string;
  kind: MosaicTileKind;
  column: number;
  columnSpan: number;
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
  coverColumnSpan: number;
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
  rowHeight: number;
  layoutSeed: number;
}

const DEFAULT_OPTIONS: HighlightsMosaicLayoutOptions = {
  gap: 12,
  maxColumnCount: 4,
  minColumnWidth: 220,
  coverAspectRatio: 1.5,
  coverWidthRatio: 0.18,
  maxCoverWidth: 280,
  minCoverWidth: 160,
  detailsHeight: 250,
  rowHeight: 8,
  layoutSeed: 0,
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

interface BentoTile {
  id: string;
  kind: MosaicTileKind;
  naturalHeight: number;
  columnSpan: number;
  minimumRow?: number;
  preferredColumn?: number;
  fixedColumn?: number;
  fixedRow?: number;
}

interface TileSlot {
  column: number;
  row: number;
  rowSpan: number;
}

function getRotatedColumns(columnCount: number, seed: number) {
  const columns = Array.from({ length: columnCount }, (_, index) => index);
  const offset = Math.abs(seed) % Math.max(1, columnCount);
  return [...columns.slice(offset), ...columns.slice(0, offset)];
}

function canOccupy(
  occupiedRows: boolean[][],
  row: number,
  column: number,
  rowSpan: number,
  columnSpan: number,
) {
  for (let rowIndex = row; rowIndex < row + rowSpan; rowIndex += 1) {
    for (
      let columnIndex = column;
      columnIndex < column + columnSpan;
      columnIndex += 1
    ) {
      if (occupiedRows[rowIndex]?.[columnIndex]) return false;
    }
  }

  return true;
}

function occupy(
  occupiedRows: boolean[][],
  slot: TileSlot,
  columnSpan: number,
  columnCount: number,
) {
  for (
    let rowIndex = slot.row;
    rowIndex < slot.row + slot.rowSpan;
    rowIndex += 1
  ) {
    const occupiedRow =
      occupiedRows[rowIndex] ?? Array<boolean>(columnCount).fill(false);
    occupiedRows[rowIndex] = occupiedRow;

    for (
      let columnIndex = slot.column;
      columnIndex < slot.column + columnSpan;
      columnIndex += 1
    ) {
      occupiedRow[columnIndex] = true;
    }
  }
}

function findTileSlot({
  tile,
  rowSpan,
  columnCount,
  occupiedRows,
  seed,
}: {
  tile: BentoTile;
  rowSpan: number;
  columnCount: number;
  occupiedRows: boolean[][];
  seed: number;
}): TileSlot {
  if (tile.fixedColumn !== undefined && tile.fixedRow !== undefined) {
    return {
      column: tile.fixedColumn,
      row: tile.fixedRow,
      rowSpan,
    };
  }

  const possibleColumnCount = columnCount - tile.columnSpan + 1;
  const preferredColumn = Math.min(
    possibleColumnCount - 1,
    tile.preferredColumn ?? 0,
  );
  const candidateColumns = getRotatedColumns(
    possibleColumnCount,
    preferredColumn + seed,
  );
  const minimumRow = tile.minimumRow ?? 0;

  for (let row = minimumRow; ; row += 1) {
    for (const column of candidateColumns) {
      if (canOccupy(occupiedRows, row, column, rowSpan, tile.columnSpan)) {
        return { column, row, rowSpan };
      }
    }
  }
}

/**
 * Packs a bento mosaic on a small virtual row grid. The dense occupancy scan
 * lets narrow cards fill gaps below wide cards instead of forcing every column
 * to stretch to the same bottom edge.
 */
export function computeHighlightsBentoLayout(
  containerWidth: number,
  items: MosaicItemMeasurement[],
  options: Partial<HighlightsMosaicLayoutOptions> = {},
): HighlightsMosaicLayout {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const { coverAspectRatio, detailsHeight, gap, layoutSeed, rowHeight } =
    resolvedOptions;
  const { columnCount, columnWidth, coverWidth } = getHighlightsMosaicGeometry(
    containerWidth,
    resolvedOptions,
  );

  if (containerWidth <= 0) {
    return {
      columnCount,
      columnWidth,
      coverColumn: 0,
      coverColumnSpan: 1,
      coverWidth,
      height: 0,
      placements: [],
    };
  }

  const hasEnoughHighlightsToNestCover =
    items.length >= Math.max(5, columnCount + 3);
  const coverColumnSpan =
    !hasEnoughHighlightsToNestCover && columnCount >= 3 ? 2 : 1;
  const lowDensityCoverColumn =
    columnCount === 1
      ? 0
      : 1 + (Math.abs(layoutSeed) % Math.max(1, columnCount - coverColumnSpan));
  const nestedCoverColumn = Math.abs(layoutSeed) % columnCount;
  const coverNaturalHeight = coverWidth * coverAspectRatio;
  const detailsRowSpan = Math.ceil((detailsHeight + gap) / rowHeight);
  const coverInsertionIndex = hasEnoughHighlightsToNestCover
    ? Math.min(items.length, 2 + (Math.abs(layoutSeed) % 3))
    : 0;
  const tiles: BentoTile[] = [
    {
      id: BOOK_DETAILS_TILE_ID,
      kind: "details",
      naturalHeight: detailsHeight,
      columnSpan: 1,
      fixedColumn: 0,
      fixedRow: 0,
    },
  ];

  const coverTile: BentoTile = {
    id: BOOK_COVER_TILE_ID,
    kind: "cover",
    naturalHeight: coverNaturalHeight,
    columnSpan: coverColumnSpan,
    ...(hasEnoughHighlightsToNestCover
      ? {
          minimumRow: Math.max(1, Math.floor(detailsRowSpan * 0.35)),
          preferredColumn: nestedCoverColumn,
        }
      : {
          fixedColumn: lowDensityCoverColumn,
          fixedRow: columnCount === 1 ? detailsRowSpan : 0,
        }),
  };

  items.forEach((item, itemIndex) => {
    if (itemIndex === coverInsertionIndex) tiles.push(coverTile);

    const columnSpan = Math.min(columnCount, item.preferredColumnSpan ?? 1);
    tiles.push({
      id: item.id,
      kind: "highlight",
      naturalHeight:
        columnSpan > 1 ? (item.wideHeight ?? item.height) : item.height,
      columnSpan,
      preferredColumn: (layoutSeed + itemIndex) % columnCount,
    });
  });

  if (coverInsertionIndex === items.length) tiles.push(coverTile);

  const occupiedRows: boolean[][] = [];
  const placements: MosaicPlacement[] = [];

  tiles.forEach((tile, tileIndex) => {
    const rowSpan = Math.max(
      1,
      Math.ceil((tile.naturalHeight + gap) / rowHeight),
    );
    const slot = findTileSlot({
      tile,
      rowSpan,
      columnCount,
      occupiedRows,
      seed: layoutSeed + tileIndex,
    });
    occupy(occupiedRows, slot, tile.columnSpan, columnCount);

    placements.push({
      id: tile.id,
      kind: tile.kind,
      column: slot.column,
      columnSpan: tile.columnSpan,
      left: slot.column * (columnWidth + gap),
      top: slot.row * rowHeight,
      width:
        columnWidth * tile.columnSpan + gap * Math.max(0, tile.columnSpan - 1),
      height: slot.rowSpan * rowHeight - gap,
      naturalHeight: tile.naturalHeight,
    });
  });

  const coverPlacement = placements.find(
    (placement) => placement.id === BOOK_COVER_TILE_ID,
  );
  const height = Math.max(
    ...placements.map((placement) => placement.top + placement.height),
  );

  return {
    columnCount,
    columnWidth,
    coverColumn: coverPlacement?.column ?? 0,
    coverColumnSpan,
    coverWidth,
    height,
    placements,
  };
}
