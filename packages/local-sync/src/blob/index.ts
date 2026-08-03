/**
 * Stable metadata stored in a sync payload for bytes managed by blob storage.
 * Transfer URLs and provider-specific object keys are deliberately excluded.
 */
export interface BlobRef {
  /** Stable application-level identifier used by synced domain records. */
  readonly blobId: string;
  /** Content hash, preferably qualified with its algorithm. */
  readonly hash: string;
  /** Stored byte count used for transfer decisions and usage accounting. */
  readonly size: number;
  readonly mediaType: string;
}
