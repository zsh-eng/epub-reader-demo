import type { FileDiffMetadata } from '@pierre/diffs';

/** Browser-safe structural input for Hunk's retained document projector. */
export interface DiffFile {
  id: string;
  path: string;
  previousPath?: string;
  patch: string;
  language?: string;
  stats: { additions: number; deletions: number };
  metadata: FileDiffMetadata;
  agent: { summary?: string } | null;
  isUntracked?: boolean;
  isBinary?: boolean;
  isTooLarge?: boolean;
  statsTruncated?: boolean;
  lineMoveKinds?: {
    additionLines: Array<'moved' | undefined>;
    deletionLines: Array<'moved' | undefined>;
  };
  sourceFetcher?: { cacheKey?: string };
}
