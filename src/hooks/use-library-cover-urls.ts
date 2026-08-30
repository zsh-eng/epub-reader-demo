import { getBookCoverFileId } from "@/lib/book-file-references";
import type { Book } from "@/lib/db";
import { files, type FileId } from "@/lib/files";
import { useCallback, useEffect, useMemo, useState } from "react";

const INITIAL_COVER_ROWS = 2;

const decodedCoverUrls = new Map<FileId, string>();
const pendingCoverLoads = new Map<FileId, Promise<string | null>>();

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
async function loadDecodedCoverUrl(fileId: FileId): Promise<string | null> {
  const cachedUrl = decodedCoverUrls.get(fileId);
  if (cachedUrl) return cachedUrl;

  const pendingLoad = pendingCoverLoads.get(fileId);
  if (pendingLoad) return pendingLoad;

  const loadPromise = (async () => {
    try {
      const blob = await files.get(fileId);
      const objectUrl = URL.createObjectURL(blob);

      try {
        await decodeImage(objectUrl);
      } catch {
        URL.revokeObjectURL(objectUrl);
        return null;
      }

      const existingUrl = decodedCoverUrls.get(fileId);
      if (existingUrl) {
        URL.revokeObjectURL(objectUrl);
        return existingUrl;
      }

      decodedCoverUrls.set(fileId, objectUrl);
      return objectUrl;
    } catch {
      return null;
    } finally {
      pendingCoverLoads.delete(fileId);
    }
  })();

  pendingCoverLoads.set(fileId, loadPromise);
  return loadPromise;
}

function getCachedCoverUrls(books: readonly Book[]): Map<string, string> {
  const result = new Map<string, string>();

  for (const book of books) {
    const fileId = getBookCoverFileId(book);
    if (!fileId) continue;

    const url = decodedCoverUrls.get(fileId);
    if (url) result.set(book.id, url);
  }

  return result;
}

export function evictLibraryCoverUrl(fileId: FileId | undefined): void {
  if (!fileId) return;

  const url = decodedCoverUrls.get(fileId);
  if (!url) return;

  URL.revokeObjectURL(url);
  decodedCoverUrls.delete(fileId);
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
    .map((book) => `${book.id}:${getBookCoverFileId(book) ?? "none"}`)
    .join("|");
  const [preparedKey, setPreparedKey] = useState(() =>
    initialBooks.every((book) => {
      const fileId = getBookCoverFileId(book);
      return !fileId || decodedCoverUrls.has(fileId);
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
        const fileId = getBookCoverFileId(book);
        if (!fileId) return null;

        const url = await loadDecodedCoverUrl(fileId);
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
    const fileId = getBookCoverFileId(book);
    if (!fileId) return;

    void loadDecodedCoverUrl(fileId).then((url) => {
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
