export const BOOK_COVER_TILE_ID = "book-cover";
export const BOOK_DETAILS_TILE_ID = "book-details";

export interface MosaicItemMeasurement {
  id: string;
  height: number;
  wideHeight?: number;
  preferredColumnSpan?: 1 | 2;
}

export type MosaicTileKind = "cover" | "details" | "highlight" | "filler";

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
  detailsHeight: number;
  rowHeight: number;
  layoutSeed: number;
}

const DEFAULT_OPTIONS: HighlightsMosaicLayoutOptions = {
  gap: 8,
  maxColumnCount: 4,
  minColumnWidth: 220,
  coverAspectRatio: 1.5,
  detailsHeight: 250,
  rowHeight: 8,
  layoutSeed: 0,
};

export function getHighlightsMosaicGeometry(
  containerWidth: number,
  options: Partial<HighlightsMosaicLayoutOptions> = {},
): Pick<HighlightsMosaicLayout, "columnCount" | "columnWidth" | "coverWidth"> {
  const { gap, maxColumnCount, minColumnWidth } = {
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
  const coverWidth = columnWidth;

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

interface EmptyColumnRun {
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
 * Turns substantial holes inside the packed content boundary into decorative
 * wall blocks. Adjacent column runs with the same shape become one wider block.
 */
function createFillerPlacements({
  occupiedRows,
  columnCount,
  columnWidth,
  gap,
  rowHeight,
}: {
  occupiedRows: boolean[][];
  columnCount: number;
  columnWidth: number;
  gap: number;
  rowHeight: number;
}): MosaicPlacement[] {
  const minimumRowSpan = Math.ceil(56 / rowHeight);
  const emptyRuns: EmptyColumnRun[] = [];

  for (let column = 0; column < columnCount; column += 1) {
    let runStart = -1;

    for (let row = 0; row <= occupiedRows.length; row += 1) {
      const isOccupied =
        row === occupiedRows.length || occupiedRows[row]?.[column];

      if (!isOccupied && runStart === -1) {
        runStart = row;
        continue;
      }

      if (!isOccupied || runStart === -1) continue;

      const rowSpan = row - runStart;
      if (rowSpan >= minimumRowSpan) {
        emptyRuns.push({ column, row: runStart, rowSpan });
      }
      runStart = -1;
    }
  }

  const unplacedRuns = [...emptyRuns];
  const placements: MosaicPlacement[] = [];

  while (unplacedRuns.length > 0) {
    const run = unplacedRuns.shift();
    if (!run) break;

    let columnSpan = 1;
    while (run.column + columnSpan < columnCount) {
      const adjacentRunIndex = unplacedRuns.findIndex(
        (candidate) =>
          candidate.column === run.column + columnSpan &&
          candidate.row === run.row &&
          candidate.rowSpan === run.rowSpan,
      );
      if (adjacentRunIndex === -1) break;

      unplacedRuns.splice(adjacentRunIndex, 1);
      columnSpan += 1;
    }

    const width = columnWidth * columnSpan + gap * Math.max(0, columnSpan - 1);
    const height = run.rowSpan * rowHeight - gap;
    placements.push({
      id: `mosaic-filler-${placements.length}`,
      kind: "filler",
      column: run.column,
      columnSpan,
      left: run.column * (columnWidth + gap),
      top: run.row * rowHeight,
      width,
      height,
      naturalHeight: height,
    });
  }

  return placements;
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
  // The one-column renderer places the compact cover inside the details tile.
  const combinesBookTiles = columnCount === 1;
  // Desktop covers remain book-sized even in sparse sections. Let quote cards
  // use wide spans, but never enlarge a cover beyond one masonry column.
  const coverColumnSpan = 1;
  const lowDensityCoverColumn =
    columnCount === 1
      ? 0
      : 1 + (Math.abs(layoutSeed) % Math.max(1, columnCount - coverColumnSpan));
  const nestedCoverColumn = Math.abs(layoutSeed) % columnCount;
  const coverFootprintWidth =
    columnWidth * coverColumnSpan + gap * Math.max(0, coverColumnSpan - 1);
  const resolvedCoverWidth = coverFootprintWidth;
  const coverNaturalHeight = resolvedCoverWidth * coverAspectRatio;
  const detailsRowSpan = Math.ceil((detailsHeight + gap) / rowHeight);
  const coverInsertionIndex = combinesBookTiles
    ? -1
    : hasEnoughHighlightsToNestCover
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
    if (!combinesBookTiles && itemIndex === coverInsertionIndex) {
      tiles.push(coverTile);
    }

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

  if (!combinesBookTiles && coverInsertionIndex === items.length) {
    tiles.push(coverTile);
  }

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
  const fillerPlacements = createFillerPlacements({
    occupiedRows,
    columnCount,
    columnWidth,
    gap,
    rowHeight,
  });

  return {
    columnCount,
    columnWidth,
    coverColumn: coverPlacement?.column ?? 0,
    coverColumnSpan,
    coverWidth: resolvedCoverWidth,
    height,
    placements: [...placements, ...fillerPlacements],
  };
}
