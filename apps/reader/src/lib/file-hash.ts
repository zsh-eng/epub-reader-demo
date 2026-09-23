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
 * Hash file data (Uint8Array) directly
 */
export async function hashFileData(data: Uint8Array): Promise<string> {
  const hasher = await getHasher();
  const hash = hasher.h64Raw(data);
  return hash.toString(16).padStart(16, "0");
}
