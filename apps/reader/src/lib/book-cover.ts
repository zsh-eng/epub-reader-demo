import { encode as encodeBlurHash } from "blurhash";

export const BOOK_COVER_MAX_WIDTH = 480;
export const BOOK_COVER_WEBP_QUALITY = 0.8;
export const BOOK_COVER_BLURHASH_COMPONENTS = { x: 4, y: 3 } as const;

const BLURHASH_SAMPLE_WIDTH = 32;

export interface CreatedBookCover {
  blob: Blob;
  blurHash: string;
  width: number;
  height: number;
}

export class BookCoverDecodeError extends Error {
  constructor(cause: unknown) {
    super("Could not decode the EPUB cover", { cause });
    this.name = "BookCoverDecodeError";
  }
}

interface DecodedCoverImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Create the fixed maximum-480 px WebP and its compact 4 by 3 BlurHash. */
export async function createBookCover(
  sourceBlob: Blob,
): Promise<CreatedBookCover> {
  const image = await decodeCoverImage(sourceBlob);

  try {
    const width = Math.min(image.width, BOOK_COVER_MAX_WIDTH);
    const height = Math.max(
      1,
      Math.round((image.height / image.width) * width),
    );
    const coverCanvas = drawResizedImage(image, width, height);
    const blurHash = createBlurHash(image);
    const blob = await encodeWebp(coverCanvas);

    if (blob.type !== "image/webp") {
      throw new Error(`WebP encoder returned unexpected type: ${blob.type}`);
    }

    return { blob, blurHash, width, height };
  } finally {
    image.close();
  }
}

function drawResizedImage(
  image: DecodedCoverImage,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = getCanvasContext(canvas);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, 0, 0, width, height);
  return canvas;
}

function createBlurHash(image: DecodedCoverImage): string {
  const width = BLURHASH_SAMPLE_WIDTH;
  const height = Math.max(
    BOOK_COVER_BLURHASH_COMPONENTS.y,
    Math.round((image.height / image.width) * width),
  );
  const canvas = drawResizedImage(image, width, height);
  const pixels = getCanvasContext(canvas).getImageData(0, 0, width, height);

  return encodeBlurHash(
    pixels.data,
    width,
    height,
    BOOK_COVER_BLURHASH_COMPONENTS.x,
    BOOK_COVER_BLURHASH_COMPONENTS.y,
  );
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not create a 2D canvas context");
  return context;
}

async function encodeWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  const nativeBlob = await encodeNativeWebp(canvas);
  if (nativeBlob?.type === "image/webp") return nativeBlob;

  const imageData = getCanvasContext(canvas).getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const { default: encodeWebpWithWasm } =
    await import("@jsquash/webp/encode.js");
  const buffer = await encodeWebpWithWasm(imageData, {
    quality: BOOK_COVER_WEBP_QUALITY * 100,
    method: 6,
  });
  return new Blob([buffer], { type: "image/webp" });
}

async function encodeNativeWebp(
  canvas: HTMLCanvasElement,
): Promise<Blob | null> {
  if (typeof canvas.toBlob !== "function") return null;

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", BOOK_COVER_WEBP_QUALITY);
  });
}

async function decodeCoverImage(sourceBlob: Blob): Promise<DecodedCoverImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(sourceBlob);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch {
      // HTMLImageElement covers browsers and image types unsupported by ImageBitmap.
    }
  }

  const objectUrl = URL.createObjectURL(sourceBlob);
  const image = new Image();
  image.src = objectUrl;

  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw new BookCoverDecodeError(error);
  }

  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    URL.revokeObjectURL(objectUrl);
    throw new BookCoverDecodeError("Cover image has invalid dimensions");
  }

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(objectUrl),
  };
}
