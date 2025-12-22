/**
 * useFileUrl Hook
 *
 * React hook for fetching files via FileManager and returning object URLs.
 * Handles automatic cleanup of object URLs when the component unmounts
 * or the file reference changes.
 */

import { fileManager, type FileType } from "@/lib/files";
import { useEffect, useState } from "react";

interface UseFileUrlState {
  /** The object URL for the file, or undefined if not loaded */
  url: string | undefined;
  /** Whether the file is currently being fetched */
  isLoading: boolean;
  /** Error message if the fetch failed */
  error: string | undefined;
  /** Whether the file was served from local cache */
  fromCache: boolean | undefined;
}

interface UseFileUrlOptions {
  /** If true, skip fetching (useful for conditional loading) */
  skip?: boolean;
  /** If true, only check local storage (no network request) */
  localOnly?: boolean;
}

/**
 * Hook for fetching a file and returning an object URL.
 *
 * @param contentHash - The content hash of the file (e.g., book's fileHash)
 * @param fileType - The type of file ('epub' or 'cover')
 * @param options - Optional settings
 * @returns State object with url, isLoading, error, and fromCache
 *
 * @example
 * ```tsx
 * function BookCover({ fileHash }: { fileHash: string }) {
 *   const { url, isLoading, error } = useFileUrl(fileHash, 'cover');
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <FallbackCover />;
 *   return <img src={url} alt="Book cover" />;
 * }
 * ```
 */
export function useFileUrl(
  contentHash: string | undefined,
  fileType: FileType,
  options: UseFileUrlOptions = {}
): UseFileUrlState {
  const { skip = false, localOnly = false } = options;

  const [state, setState] = useState<UseFileUrlState>({
    url: undefined,
    isLoading: false,
    error: undefined,
    fromCache: undefined,
  });

  useEffect(() => {
    // Skip if no content hash or explicitly skipped
    if (!contentHash || skip) {
      setState({
        url: undefined,
        isLoading: false,
        error: undefined,
        fromCache: undefined,
      });
      return;
    }

    let isMounted = true;
    let objectUrl: string | undefined;

    async function fetchFile() {
      setState((prev) => ({ ...prev, isLoading: true, error: undefined }));

      try {
        const result = await fileManager.getFile(contentHash!, fileType, {
          localOnly,
        });

        if (!isMounted) {
          return;
        }

        // Create object URL from blob
        objectUrl = URL.createObjectURL(result.blob);

        setState({
          url: objectUrl,
          isLoading: false,
          error: undefined,
          fromCache: result.fromCache,
        });
      } catch (err) {
        if (!isMounted) {
          return;
        }

        setState({
          url: undefined,
          isLoading: false,
          error: err instanceof Error ? err.message : "Failed to fetch file",
          fromCache: undefined,
        });
      }
    }

    fetchFile();

    // Cleanup: revoke object URL when unmounting or dependencies change
    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [contentHash, fileType, skip, localOnly]);

  return state;
}

/**
 * Hook for checking if a file exists locally (no network request).
 *
 * @param contentHash - The content hash of the file
 * @param fileType - The type of file
 * @returns Object with hasLocal boolean and isChecking state
 */
export function useHasLocalFile(
  contentHash: string | undefined,
  fileType: FileType
): { hasLocal: boolean | undefined; isChecking: boolean } {
  const [hasLocal, setHasLocal] = useState<boolean | undefined>(undefined);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (!contentHash) {
      setHasLocal(undefined);
      return;
    }

    let isMounted = true;

    async function check() {
      setIsChecking(true);
      try {
        const result = await fileManager.hasLocal(contentHash!, fileType);
        if (isMounted) {
          setHasLocal(result);
        }
      } catch {
        if (isMounted) {
          setHasLocal(false);
        }
      } finally {
        if (isMounted) {
          setIsChecking(false);
        }
      }
    }

    check();

    return () => {
      isMounted = false;
    };
  }, [contentHash, fileType]);

  return { hasLocal, isChecking };
}
