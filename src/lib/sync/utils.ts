/**
 * Utility functions for sync operations
 */

import { SyncError, SyncErrorType } from "./types";

/**
 * Determines if an error is retryable based on its type
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof SyncError) {
    return error.retryable;
  }

  // Network errors are retryable
  if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
    return true;
  }

  return false;
}

/**
 * Converts a fetch response error to a typed SyncError
 */
export async function handleFetchError(response: Response): Promise<never> {
  let errorMessage = `Request failed: ${response.status}`;
  let errorType: SyncErrorType = "unknown";
  let retryable = false;

  try {
    const errorData = await response.json();
    errorMessage = (errorData as { error?: string }).error ?? errorMessage;
  } catch {
    // Ignore JSON parse errors
  }

  switch (response.status) {
    case 401:
    case 403:
      errorType = "unauthorized";
      retryable = false;
      break;
    case 404:
      errorType = "not_found";
      retryable = false;
      break;
    case 408:
    case 429:
    case 502:
    case 503:
    case 504:
      errorType = "network";
      retryable = true;
      break;
    case 500:
      errorType = "server_error";
      retryable = true;
      break;
    default:
      if (response.status >= 500) {
        errorType = "server_error";
        retryable = true;
      }
  }

  throw new SyncError(errorMessage, errorType, retryable);
}

/**
 * Determines media type from file extension
 */
export function getMediaTypeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "xhtml":
    case "html":
      return "application/xhtml+xml";
    case "xml":
      return "application/xml";
    case "css":
      return "text/css";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "ncx":
      return "application/x-dtbncx+xml";
    case "opf":
      return "application/oebps-package+xml";
    default:
      return "application/octet-stream";
  }
}

/**
 * Detects media type from blob content (magic bytes)
 */
export async function detectMediaTypeFromBlob(
  blob: Blob,
): Promise<string | null> {
  if (blob.type && blob.type !== "application/octet-stream") {
    return blob.type;
  }

  // Read first few bytes to detect type
  const arrayBuffer = await blob.slice(0, 8).arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // JPEG magic bytes
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }

  // PNG magic bytes
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return "image/png";
  }

  // GIF magic bytes
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }

  // WebP magic bytes
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Simple concurrency limiter for parallel operations
 */
export async function pLimit<T, R>(
  concurrency: number,
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = fn(item).then((result) => {
      results.push(result);
      executing.splice(executing.indexOf(promise), 1);
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Exponential backoff retry logic
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if error is not retryable
      if (!isRetryableError(error)) {
        throw error;
      }

      // Don't wait after last attempt
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * 0.3 * delay; // Add 0-30% jitter
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      }
    }
  }

  throw lastError;
}
