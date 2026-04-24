import { getBookFile } from "@/lib/db";
import {
  cleanupResourceUrls,
  getDeferredEpubImagePath,
} from "@/lib/epub-resource-utils";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface DeferredEpubImageStore {
  getUrl: (resourcePath: string) => string | null;
  loadUrl: (resourcePath: string) => Promise<string | null>;
}

const DeferredEpubImageContext =
  createContext<DeferredEpubImageStore | null>(null);

interface DeferredEpubImageProviderProps {
  bookId: string;
  children: ReactNode;
}

/**
 * Owns deferred EPUB image object URLs for a single reader session.
 *
 * Images are loaded on demand by descendants, reused while the reader stays
 * open, and revoked together when this provider unmounts.
 */
export function DeferredEpubImageProvider({
  bookId,
  children,
}: DeferredEpubImageProviderProps) {
  const objectUrlsRef = useRef<Map<string, string>>(new Map());
  const pendingLoadsRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const disposedRef = useRef(false);

  const getUrl = useCallback((resourcePath: string): string | null => {
    return objectUrlsRef.current.get(resourcePath) ?? null;
  }, []);

  const loadUrl = useCallback(
    async (resourcePath: string): Promise<string | null> => {
      const cachedUrl = objectUrlsRef.current.get(resourcePath);
      if (cachedUrl) {
        return cachedUrl;
      }

      const pendingLoad = pendingLoadsRef.current.get(resourcePath);
      if (pendingLoad) {
        return pendingLoad;
      }

      const loadPromise = (async () => {
        const resourceFile = await getBookFile(bookId, resourcePath);
        if (!resourceFile) {
          console.warn("[LazyImage] Deferred image not found:", resourcePath);
          return null;
        }

        const existingUrl = objectUrlsRef.current.get(resourcePath);
        if (existingUrl) {
          return existingUrl;
        }

        const objectUrl = URL.createObjectURL(resourceFile.content);
        if (disposedRef.current) {
          URL.revokeObjectURL(objectUrl);
          return null;
        }

        objectUrlsRef.current.set(resourcePath, objectUrl);
        return objectUrl;
      })();

      pendingLoadsRef.current.set(resourcePath, loadPromise);

      try {
        return await loadPromise;
      } finally {
        pendingLoadsRef.current.delete(resourcePath);
      }
    },
    [bookId],
  );

  useEffect(() => {
    disposedRef.current = false;
    const pendingLoads = pendingLoadsRef.current;
    const objectUrls = objectUrlsRef.current;

    return () => {
      disposedRef.current = true;
      pendingLoads.clear();
      cleanupResourceUrls(objectUrls);
    };
  }, []);

  const store = useMemo<DeferredEpubImageStore>(
    () => ({
      getUrl,
      loadUrl,
    }),
    [getUrl, loadUrl],
  );

  return (
    <DeferredEpubImageContext.Provider value={store}>
      {children}
    </DeferredEpubImageContext.Provider>
  );
}

export function useDeferredEpubImage(src: string) {
  const store = useContext(DeferredEpubImageContext);
  const resourcePath = getDeferredEpubImagePath(src);
  const deferredStore = resourcePath ? store : null;
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() => {
    if (!resourcePath) {
      return src;
    }

    return deferredStore?.getUrl(resourcePath) ?? null;
  });

  if (resourcePath && !deferredStore) {
    throw new Error(
      "Deferred EPUB images must be rendered within DeferredEpubImageProvider.",
    );
  }

  useEffect(() => {
    let cancelled = false;

    if (!resourcePath) {
      setResolvedSrc(src);
      return () => {
        cancelled = true;
      };
    }

    const activeStore = deferredStore;
    if (!activeStore) {
      return () => {
        cancelled = true;
      };
    }

    const cachedUrl = activeStore.getUrl(resourcePath);
    if (cachedUrl) {
      setResolvedSrc(cachedUrl);
      return () => {
        cancelled = true;
      };
    }

    setResolvedSrc(null);

    void activeStore.loadUrl(resourcePath).then((loadedUrl) => {
      if (cancelled || !loadedUrl) {
        return;
      }

      setResolvedSrc(loadedUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [deferredStore, resourcePath, src]);

  return {
    isLoading: !!resourcePath && !resolvedSrc,
    resolvedSrc,
  };
}
