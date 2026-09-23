import type {
  Block,
  InlineRun,
  PublisherInlineStyle,
  PublisherTextStyle,
  TextBlock,
} from "./types";

const BODY_SCALE_BUCKET_SIZE = 0.01;
const MIN_BODY_SAMPLE_CHARS = 1_000;
const MIN_BODY_BLOCK_CHARS = 80;
const MIN_DOMINANT_BODY_SHARE = 0.55;
const MIN_NORMALIZABLE_SCALE = 0.55;
const MAX_NORMALIZABLE_SCALE = 1.6;
const MIN_MEANINGFUL_SCALE_DELTA = 0.03;
const MIN_PUBLISHER_SCALE = 0.55;
const MAX_PUBLISHER_SCALE = 4;

interface BodyScaleBucket {
  scale: number;
  chars: number;
}

function getRunTextLength(run: InlineRun): number {
  return run.text.replace(/\s+/g, " ").trim().length;
}

function getBlockTextLength(block: TextBlock): number {
  return block.runs.reduce((total, run) => total + getRunTextLength(run), 0);
}

function isBodyScaleCandidate(block: TextBlock): boolean {
  if (block.tag !== "p" && block.tag !== "li") return false;

  const role = block.publisherStyle?.role ?? "body";
  return role === "body" || role === "list";
}

function bucketFontScale(scale: number): number {
  return Math.round(scale / BODY_SCALE_BUCKET_SIZE) * BODY_SCALE_BUCKET_SIZE;
}

function clampPublisherFontScale(scale: number): number {
  return Math.max(
    MIN_PUBLISHER_SCALE,
    Math.min(MAX_PUBLISHER_SCALE, scale),
  );
}

function normalizeScale(
  scale: number | undefined,
  bodyFontScale: number,
): number | undefined {
  if (scale === undefined) return undefined;
  return clampPublisherFontScale(scale / bodyFontScale);
}

function normalizePublisherStyle(
  style: PublisherTextStyle | undefined,
  bodyFontScale: number,
): PublisherTextStyle | undefined {
  if (!style?.fontScale) return style;
  const fontScale = normalizeScale(style.fontScale, bodyFontScale);
  if (fontScale === undefined) return style;

  return {
    ...style,
    fontScale,
  };
}

function normalizePublisherInlineStyle(
  style: PublisherInlineStyle | undefined,
  bodyFontScale: number,
): PublisherInlineStyle | undefined {
  if (!style?.fontScale) return style;
  const fontScale = normalizeScale(style.fontScale, bodyFontScale);
  if (fontScale === undefined) return style;

  return {
    ...style,
    fontScale,
  };
}

function getNormalizableBodyScale(scale: number | undefined): number | null {
  if (!scale || !Number.isFinite(scale)) return null;
  if (scale < MIN_NORMALIZABLE_SCALE || scale > MAX_NORMALIZABLE_SCALE) {
    return null;
  }
  if (Math.abs(scale - 1) < MIN_MEANINGFUL_SCALE_DELTA) return null;
  return scale;
}

/**
 * Infers the publisher's main prose scale from substantial body/list
 * paragraphs. The result is intentionally conservative: it only returns a
 * scale when one bucket clearly dominates the text by character weight.
 */
export function inferPublisherBodyFontScale(
  blocks: readonly Block[],
): number | undefined {
  const buckets = new Map<number, BodyScaleBucket>();
  let totalChars = 0;

  for (const block of blocks) {
    if (block.type !== "text" || !isBodyScaleCandidate(block)) continue;

    const chars = getBlockTextLength(block);
    if (chars < MIN_BODY_BLOCK_CHARS) continue;

    const scale = block.publisherStyle?.fontScale ?? 1;
    const bucketScale = bucketFontScale(scale);
    const bucket = buckets.get(bucketScale) ?? {
      scale: bucketScale,
      chars: 0,
    };
    bucket.chars += chars;
    buckets.set(bucketScale, bucket);
    totalChars += chars;
  }

  if (totalChars < MIN_BODY_SAMPLE_CHARS) return undefined;

  const dominant = [...buckets.values()].sort((a, b) => b.chars - a.chars)[0];
  if (!dominant) return undefined;
  if (dominant.chars / totalChars < MIN_DOMINANT_BODY_SHARE) {
    return undefined;
  }

  return getNormalizableBodyScale(dominant.scale) ?? undefined;
}

/**
 * Maps the inferred publisher prose scale onto the reader's selected font size
 * while retaining publisher relative scale differences.
 */
export function normalizePublisherBodyFontScale(
  blocks: readonly Block[],
  bodyFontScale: number | undefined,
): Block[] {
  const normalizableScale = getNormalizableBodyScale(bodyFontScale);
  if (!normalizableScale) return [...blocks];

  return blocks.map((block) => {
    if (block.type !== "text") return block;

    return {
      ...block,
      publisherStyle: normalizePublisherStyle(
        block.publisherStyle,
        normalizableScale,
      ),
      runs: block.runs.map((run) => ({
        ...run,
        publisherInlineStyle: normalizePublisherInlineStyle(
          run.publisherInlineStyle,
          normalizableScale,
        ),
      })),
    };
  });
}
