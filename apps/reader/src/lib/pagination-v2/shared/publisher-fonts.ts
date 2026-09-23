import type { Block, PublisherFontFace } from "./types";

const loadedPublisherFontKeys = new Set<string>();
let publisherFontLoadQueue = Promise.resolve();

function getFontFaceSet(): FontFaceSet | undefined {
  const scope = globalThis as {
    document?: { fonts?: FontFaceSet };
    fonts?: FontFaceSet;
  };

  return scope.fonts ?? scope.document?.fonts;
}

export function getPublisherFontFaceKey(face: PublisherFontFace): string {
  return [
    face.family,
    face.descriptors.style ?? "normal",
    face.descriptors.weight ?? "400",
    face.descriptors.unicodeRange ?? "all",
    face.src,
  ].join("|");
}

export function collectPublisherFontFacesFromBlocks(
  blocks: readonly Block[],
): PublisherFontFace[] {
  const seen = new Set<string>();
  const faces: PublisherFontFace[] = [];

  for (const block of blocks) {
    if (block.type !== "text" || !block.publisherFontFaces) continue;

    for (const face of block.publisherFontFaces) {
      const key = getPublisherFontFaceKey(face);
      if (seen.has(key)) continue;
      seen.add(key);
      faces.push(face);
    }
  }

  return faces;
}

export async function ensurePublisherFontFacesReady(
  faces: readonly PublisherFontFace[],
): Promise<void> {
  if (faces.length === 0) return;

  const fontFaceSet = getFontFaceSet();
  if (!fontFaceSet || typeof FontFace === "undefined") return;

  const pendingFaces = faces.filter((face) => {
    const key = getPublisherFontFaceKey(face);
    if (loadedPublisherFontKeys.has(key)) return false;
    loadedPublisherFontKeys.add(key);
    return true;
  });
  if (pendingFaces.length === 0) return;

  publisherFontLoadQueue = publisherFontLoadQueue.then(async () => {
    const loaded = pendingFaces.map(async (face) => {
      try {
        const fontFace = new FontFace(face.family, face.src, face.descriptors);
        await fontFace.load();
        fontFaceSet.add(fontFace);
      } catch (error) {
        console.warn("[pagination] Failed to load publisher font", {
          family: face.family,
          error,
        });
      }
    });

    await Promise.all(loaded);
  });

  await publisherFontLoadQueue;
}

export async function ensurePublisherFontsReadyFromBlocks(
  blocks: readonly Block[],
): Promise<void> {
  await ensurePublisherFontFacesReady(collectPublisherFontFacesFromBlocks(blocks));
}
