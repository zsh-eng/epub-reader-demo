import xxhash from "xxhash-wasm";

let hasherInstance: Awaited<ReturnType<typeof xxhash>> | null = null;

/**
 * Initialize the xxhash WASM instance
 * This is cached so subsequent calls are instant
 */
async function getHasher() {
  if (!hasherInstance) {
    hasherInstance = await xxhash();
  }
  return hasherInstance;
}

/**
 * Hash a file using xxhash 64-bit
 * Returns a 16-character hex string
 */
export async function hashFile(file: File): Promise<string> {
  const hasher = await getHasher();
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Use h64Raw for Uint8Array input, then convert to hex string
  const hash = hasher.h64Raw(uint8Array);
  return hash.toString(16).padStart(16, "0");
}

/**
 * Hash file data (Uint8Array) directly
 */
export async function hashFileData(data: Uint8Array): Promise<string> {
  const hasher = await getHasher();
  const hash = hasher.h64Raw(data);
  return hash.toString(16).padStart(16, "0");
}
