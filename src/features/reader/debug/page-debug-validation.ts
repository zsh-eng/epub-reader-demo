import type { ReaderPageDebugDump } from "./page-debug-dump";

type DebugDumpPageSlot = NonNullable<
  ReaderPageDebugDump["environment"]
>["pageSlots"][number];

export type ReaderPageDebugIssueSeverity = "error" | "warning";

export interface ReaderPageDebugIssue {
  code: string;
  severity: ReaderPageDebugIssueSeverity;
  message: string;
  page: number | null;
  slotIndex?: number;
  sliceIndex?: number;
  blockId?: string;
  details?: Record<string, number | string | null>;
}

export interface ReaderPageDebugValidationSummary {
  page: number;
  totalPages: number;
  pageSlotCount: number;
  pageOverflowY: number;
  contentOverflowY: number;
  expectedTextLines: number;
  visualTextLines: number | null;
  expectedTextHeight: number;
  renderedTextHeight: number;
  textSliceOverflowY: number;
  overflowingTextSliceCount: number;
}

export interface ReaderPageDebugValidationResult {
  ok: boolean;
  issues: ReaderPageDebugIssue[];
  summary: ReaderPageDebugValidationSummary;
  suspectSlice: DebugDumpPageSlot["slices"][number] | null;
}

const OVERFLOW_TOLERANCE_PX = 1.5;
const HEIGHT_TOLERANCE_PX = 1.5;

function sumKnownNumbers(values: Array<number | null | undefined>): number {
  return values.reduce<number>(
    (sum, value) =>
      typeof value === "number" && Number.isFinite(value) ? sum + value : sum,
    0,
  );
}

function getPrimaryPageSlot(
  dump: ReaderPageDebugDump,
  pageSlots: DebugDumpPageSlot[],
) {
  return (
    pageSlots.find((pageSlot) => pageSlot.currentPage === dump.page.currentPage) ??
    pageSlots[0] ??
    null
  );
}

function getPageSliceSummary(pageSlot: DebugDumpPageSlot | null) {
  const slices = pageSlot?.slices ?? [];
  const textSlices = slices.filter((slice) => slice.type === "text");
  const visualLineValues = textSlices.map(
    (slice) => slice.visualLines?.lineCount,
  );
  const visualTextLines =
    visualLineValues.some((value) => typeof value === "number")
      ? sumKnownNumbers(visualLineValues)
      : null;
  const overflowingTextSlices = textSlices.filter(
    (slice) => slice.metrics.overflowY > OVERFLOW_TOLERANCE_PX,
  );

  return {
    expectedTextHeight: sumKnownNumbers(
      textSlices.map((slice) => slice.expectedHeight),
    ),
    renderedTextHeight: sumKnownNumbers(
      textSlices.map((slice) => slice.metrics.scrollHeight),
    ),
    expectedTextLines: sumKnownNumbers(textSlices.map((slice) => slice.lineCount)),
    visualTextLines,
    overflowingTextSliceCount: overflowingTextSlices.length,
    textSliceOverflowY: sumKnownNumbers(
      textSlices.map((slice) => Math.max(0, slice.metrics.overflowY)),
    ),
  };
}

function getSliceSuspectScore(
  slice: DebugDumpPageSlot["slices"][number],
  pageContent: DebugDumpPageSlot["contentMetrics"] | undefined,
) {
  const extraDomLines =
    slice.lineCount !== null && slice.visualLines
      ? Math.max(0, slice.visualLines.lineCount - slice.lineCount)
      : 0;
  const overflow = Math.max(0, slice.metrics.overflowY);
  const bottomCrossing = pageContent
    ? Math.max(0, slice.metrics.rect.bottom - pageContent.rect.bottom)
    : 0;

  return extraDomLines * 1_000 + overflow * 10 + bottomCrossing;
}

function getSuspectSlice(
  pageSlot: DebugDumpPageSlot | null,
  pageContent: DebugDumpPageSlot["contentMetrics"] | undefined,
) {
  return (
    (pageSlot?.slices ?? [])
      .map((slice) => ({
        slice,
        score: getSliceSuspectScore(slice, pageContent),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.slice ?? null
  );
}

function pushOverflowIssue(
  issues: ReaderPageDebugIssue[],
  options: {
    code: string;
    message: string;
    page: number | null;
    overflowY: number;
    slotIndex?: number;
    sliceIndex?: number;
    blockId?: string;
  },
) {
  if (options.overflowY <= OVERFLOW_TOLERANCE_PX) return;

  issues.push({
    code: options.code,
    severity: "error",
    message: options.message,
    page: options.page,
    slotIndex: options.slotIndex,
    sliceIndex: options.sliceIndex,
    blockId: options.blockId,
    details: { overflowY: options.overflowY },
  });
}

export function validateReaderPageDebugDump(
  dump: ReaderPageDebugDump,
): ReaderPageDebugValidationResult {
  const environment = dump.environment;
  const pageSlots = environment?.pageSlots ?? [];
  const primaryPageSlot = environment
    ? getPrimaryPageSlot(dump, pageSlots)
    : null;
  const primaryPageContent = primaryPageSlot?.contentMetrics ?? null;
  const pageSliceSummary = getPageSliceSummary(primaryPageSlot);
  const issues: ReaderPageDebugIssue[] = [];

  if (!environment) {
    issues.push({
      code: "missing-environment",
      severity: "error",
      message: "Reader Page Debug Dump is missing rendered DOM environment data.",
      page: dump.page.currentPage,
    });
  }

  if (environment && pageSlots.length === 0) {
    issues.push({
      code: "missing-page-slot",
      severity: "error",
      message: "Rendered spread did not expose any page slots.",
      page: dump.page.currentPage,
    });
  }

  if (environment?.stageSlot) {
    pushOverflowIssue(issues, {
      code: "stage-slot-overflow",
      message: "Reader stage slot overflows vertically.",
      page: dump.page.currentPage,
      overflowY: environment.stageSlot.overflowY,
    });
  }

  if (environment?.stageContent) {
    pushOverflowIssue(issues, {
      code: "stage-content-overflow",
      message: "Reader stage content overflows vertically.",
      page: dump.page.currentPage,
      overflowY: environment.stageContent.overflowY,
    });
  }

  if (primaryPageSlot) {
    pushOverflowIssue(issues, {
      code: "page-slot-overflow",
      message: "Rendered page slot overflows vertically.",
      page: primaryPageSlot.currentPage,
      slotIndex: primaryPageSlot.slotIndex,
      overflowY: primaryPageSlot.metrics.overflowY,
    });
  }

  if (primaryPageContent) {
    pushOverflowIssue(issues, {
      code: "page-content-overflow",
      message: "Rendered page content overflows vertically.",
      page: primaryPageSlot?.currentPage ?? dump.page.currentPage,
      slotIndex: primaryPageSlot?.slotIndex,
      overflowY: primaryPageContent.overflowY,
    });
  }

  for (const slice of primaryPageSlot?.slices ?? []) {
    pushOverflowIssue(issues, {
      code: "slice-overflow",
      message: "Rendered page slice overflows vertically.",
      page: primaryPageSlot?.currentPage ?? dump.page.currentPage,
      slotIndex: primaryPageSlot?.slotIndex,
      sliceIndex: slice.sliceIndex,
      blockId: slice.blockId,
      overflowY: slice.metrics.overflowY,
    });

    if (slice.type !== "text") continue;

    const expectedLineCount = slice.lineCount;
    const visualLineCount = slice.visualLines?.lineCount;
    if (
      expectedLineCount !== null &&
      visualLineCount !== undefined &&
      visualLineCount > expectedLineCount
    ) {
      issues.push({
        code: "extra-dom-lines",
        severity: "error",
        message: "Rendered text produced more visual lines than pagination modeled.",
        page: primaryPageSlot?.currentPage ?? dump.page.currentPage,
        slotIndex: primaryPageSlot?.slotIndex,
        sliceIndex: slice.sliceIndex,
        blockId: slice.blockId,
        details: {
          expectedLineCount,
          visualLineCount,
        },
      });
    }

    if (
      primaryPageContent &&
      slice.metrics.rect.bottom - primaryPageContent.rect.bottom >
        HEIGHT_TOLERANCE_PX
    ) {
      issues.push({
        code: "slice-crosses-page-bottom",
        severity: "error",
        message: "Rendered page slice crosses the bottom of the page content box.",
        page: primaryPageSlot?.currentPage ?? dump.page.currentPage,
        slotIndex: primaryPageSlot?.slotIndex,
        sliceIndex: slice.sliceIndex,
        blockId: slice.blockId,
        details: {
          bottomCrossing:
            slice.metrics.rect.bottom - primaryPageContent.rect.bottom,
        },
      });
    }
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
    summary: {
      page: dump.page.currentPage,
      totalPages: dump.page.totalPages,
      pageSlotCount: pageSlots.length,
      pageOverflowY: primaryPageSlot?.metrics.overflowY ?? 0,
      contentOverflowY: primaryPageContent?.overflowY ?? 0,
      ...pageSliceSummary,
    },
    suspectSlice: getSuspectSlice(primaryPageSlot, primaryPageContent),
  };
}
