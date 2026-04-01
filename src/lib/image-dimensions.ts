export interface ImageDimensions {
  width: number;
  height: number;
}

const JPEG_SOF_MARKERS = new Set<number>([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
  0xcf,
]);

function isPositiveDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function toDimensions(width: number, height: number): ImageDimensions | null {
  if (!isPositiveDimension(width) || !isPositiveDimension(height)) {
    return null;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

function parsePngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;

  const isPngSignature =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  const isIHDRChunk =
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52;

  if (!isPngSignature || !isIHDRChunk) return null;

  const width =
    (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height =
    (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];

  return toDimensions(width >>> 0, height >>> 0);
}

function parseGifDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10) return null;

  const isGifHeader =
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61;

  if (!isGifHeader) return null;

  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  return toDimensions(width, height);
}

function parseJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    let markerOffset = offset + 1;
    while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) {
      markerOffset += 1;
    }
    if (markerOffset >= bytes.length) return null;

    const marker = bytes[markerOffset];
    offset = markerOffset + 1;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 1 >= bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return toDimensions(width, height);
    }

    offset += segmentLength;
  }

  return null;
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function parseWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 16) return null;

  const isRiff =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46;
  const isWebp =
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  if (!isRiff || !isWebp) return null;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    const chunkSize =
      bytes[offset + 4] |
      (bytes[offset + 5] << 8) |
      (bytes[offset + 6] << 16) |
      (bytes[offset + 7] << 24);
    const normalizedChunkSize = chunkSize >>> 0;
    const chunkDataOffset = offset + 8;

    if (chunkDataOffset + normalizedChunkSize > bytes.length) {
      return null;
    }

    if (chunkType === "VP8X" && normalizedChunkSize >= 10) {
      const width = 1 + readUInt24LE(bytes, chunkDataOffset + 4);
      const height = 1 + readUInt24LE(bytes, chunkDataOffset + 7);
      return toDimensions(width, height);
    }

    if (chunkType === "VP8 " && normalizedChunkSize >= 10) {
      if (
        bytes[chunkDataOffset + 3] !== 0x9d ||
        bytes[chunkDataOffset + 4] !== 0x01 ||
        bytes[chunkDataOffset + 5] !== 0x2a
      ) {
        return null;
      }

      const rawWidth =
        bytes[chunkDataOffset + 6] | (bytes[chunkDataOffset + 7] << 8);
      const rawHeight =
        bytes[chunkDataOffset + 8] | (bytes[chunkDataOffset + 9] << 8);
      return toDimensions(rawWidth & 0x3fff, rawHeight & 0x3fff);
    }

    if (chunkType === "VP8L" && normalizedChunkSize >= 5) {
      if (bytes[chunkDataOffset] !== 0x2f) {
        return null;
      }

      const b1 = bytes[chunkDataOffset + 1];
      const b2 = bytes[chunkDataOffset + 2];
      const b3 = bytes[chunkDataOffset + 3];
      const b4 = bytes[chunkDataOffset + 4];

      const width = 1 + (b1 | ((b2 & 0x3f) << 8));
      const height = 1 + (((b2 & 0xc0) >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
      return toDimensions(width, height);
    }

    offset =
      chunkDataOffset +
      normalizedChunkSize +
      (normalizedChunkSize % 2);
  }

  return null;
}

function parseStrictSvgLength(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^([0-9]*\.?[0-9]+)(px)?$/i.exec(trimmed);
  if (!match) return null;
  const parsed = Number(match[1]);
  return isPositiveDimension(parsed) ? parsed : null;
}

function parseSvgDimensions(bytes: Uint8Array): ImageDimensions | null {
  const text = new TextDecoder().decode(bytes);
  const svgTagMatch = /<svg\b[^>]*>/i.exec(text);
  if (!svgTagMatch) return null;

  const svgTag = svgTagMatch[0];
  const widthMatch = /\bwidth\s*=\s*["']([^"']+)["']/i.exec(svgTag);
  const heightMatch = /\bheight\s*=\s*["']([^"']+)["']/i.exec(svgTag);
  const width = parseStrictSvgLength(widthMatch?.[1]);
  const height = parseStrictSvgLength(heightMatch?.[1]);

  if (width && height) {
    return toDimensions(width, height);
  }

  const viewBoxMatch = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(svgTag);
  if (!viewBoxMatch) return null;

  const values = viewBoxMatch[1]
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (values.length !== 4) return null;
  return toDimensions(values[2], values[3]);
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const probeLength = Math.min(bytes.length, 512);
  const probe = new TextDecoder().decode(bytes.slice(0, probeLength));
  return /<svg[\s>]/i.test(probe);
}

export function extractImageDimensionsFromBytes(
  bytes: Uint8Array,
  mediaType?: string,
): ImageDimensions | null {
  const normalizedMediaType = mediaType?.toLowerCase();

  if (normalizedMediaType?.includes("svg")) {
    return parseSvgDimensions(bytes);
  }

  return (
    parsePngDimensions(bytes) ??
    parseGifDimensions(bytes) ??
    parseJpegDimensions(bytes) ??
    parseWebpDimensions(bytes) ??
    (looksLikeSvg(bytes) ? parseSvgDimensions(bytes) : null)
  );
}

export async function extractImageDimensionsFromBlob(
  blob: Blob,
  mediaType?: string,
): Promise<ImageDimensions | null> {
  const arrayBuffer = await blob.arrayBuffer();
  return extractImageDimensionsFromBytes(new Uint8Array(arrayBuffer), mediaType);
}
