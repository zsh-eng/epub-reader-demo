import { fileManager } from "@/lib/files";
import type { Book } from "@/lib/db";
import { useCallback, useEffect, useMemo, useState } from "react";

const INITIAL_COVER_ROWS = 2;

const decodedCoverUrls = new Map<string, string>();
const pendingCoverLoads = new Map<string, Promise<string | null>>();

async function decodeImage(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  await image.decode();
}

function getInitialCoverLimit(): number {
  if (typeof window === "undefined") return 16;

  const width = window.innerWidth;
  const columns =
    width >= 1536
      ? 8
      : width >= 1280
        ? 6
        : width >= 1024
          ? 5
          : width >= 768
            ? 4
            : width >= 640
              ? 3
              : 2;
  return columns * INITIAL_COVER_ROWS;
}

/**
 * Loads and decodes a cover once for the application session. Keeping the
 * object URL across library mounts prevents a second blank-to-cover swap when
 * the user returns from the reader.
 */
async function loadDecodedCoverUrl(
  contentHash: string,
): Promise<string | null> {
  const cachedUrl = decodedCoverUrls.get(contentHash);
  if (cachedUrl) return cachedUrl;

  const pendingLoad = pendingCoverLoads.get(contentHash);
  if (pendingLoad) return pendingLoad;

  const loadPromise = (async () => {
    try {
      const result = await fileManager.getFile(contentHash, "cover");
      const objectUrl = URL.createObjectURL(result.blob);

      try {
        await decodeImage(objectUrl);
      } catch {
        URL.revokeObjectURL(objectUrl);
        return null;
      }

      const existingUrl = decodedCoverUrls.get(contentHash);
      if (existingUrl) {
        URL.revokeObjectURL(objectUrl);
        return existingUrl;
      }

      decodedCoverUrls.set(contentHash, objectUrl);
      return objectUrl;
    } catch {
      return null;
    } finally {
      pendingCoverLoads.delete(contentHash);
    }
  })();

  pendingCoverLoads.set(contentHash, loadPromise);
  return loadPromise;
}

function getCoverHash(book: Book): string | null {
  return book.coverContentHash ?? null;
}

function getCachedCoverUrls(books: readonly Book[]): Map<string, string> {
  const result = new Map<string, string>();

  for (const book of books) {
    const contentHash = getCoverHash(book);
    if (!contentHash) continue;

    const url = decodedCoverUrls.get(contentHash);
    if (url) result.set(book.id, url);
  }

  return result;
}

export function evictLibraryCoverUrl(contentHash: string | undefined): void {
  if (!contentHash) return;

  const url = decodedCoverUrls.get(contentHash);
  if (!url) return;

  URL.revokeObjectURL(url);
  decodedCoverUrls.delete(contentHash);
}

interface UseLibraryCoverUrlsResult {
  coverUrls: ReadonlyMap<string, string>;
  initialCoversReady: boolean;
  requestCover: (book: Book) => void;
}

/**
 * Prepares the first visible cover group as one presentation unit. The first
 * two rows can use local storage or the network. Later covers load when their
 * cards approach the viewport.
 */
export function useLibraryCoverUrls(
  books: readonly Book[],
): UseLibraryCoverUrlsResult {
  const [initialCoverLimit] = useState(getInitialCoverLimit);
  const initialBooks = useMemo(
    () => books.slice(0, initialCoverLimit),
    [books, initialCoverLimit],
  );
  const initialKey = initialBooks
    .map((book) => `${book.id}:${getCoverHash(book) ?? "none"}`)
    .join("|");
  const [preparedKey, setPreparedKey] = useState(() =>
    initialBooks.every((book) => {
      const contentHash = getCoverHash(book);
      return !contentHash || decodedCoverUrls.has(contentHash);
    })
      ? initialKey
      : "",
  );
  const [coverUrls, setCoverUrls] = useState<Map<string, string>>(() =>
    getCachedCoverUrls(books),
  );

  useEffect(() => {
    let cancelled = false;

    void Promise.all(
      initialBooks.map(async (book) => {
        const contentHash = getCoverHash(book);
        if (!contentHash) return null;

        const url = await loadDecodedCoverUrl(contentHash);
        return url ? ([book.id, url] as const) : null;
      }),
    ).then((entries) => {
      if (cancelled) return;

      setCoverUrls((current) => {
        const next = new Map(current);
        for (const entry of entries) {
          if (entry) next.set(...entry);
        }
        return next;
      });
      setPreparedKey(initialKey);
    });

    return () => {
      cancelled = true;
    };
  }, [initialBooks, initialKey]);

  const requestCover = useCallback((book: Book) => {
    const contentHash = getCoverHash(book);
    if (!contentHash) return;

    void loadDecodedCoverUrl(contentHash).then((url) => {
      if (!url) return;
      setCoverUrls((current) => {
        if (current.get(book.id) === url) return current;
        const next = new Map(current);
        next.set(book.id, url);
        return next;
      });
    });
  }, []);

  return {
    coverUrls,
    initialCoversReady: preparedKey === initialKey,
    requestCover,
  };
}
