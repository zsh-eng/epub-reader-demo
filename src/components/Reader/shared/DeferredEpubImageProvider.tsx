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

const DeferredEpubImageContext = createContext<DeferredEpubImageStore | null>(
  null,
);

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
  const pendingLoadsRef = useRef<Map<string, Promise<string | null>>>(
    new Map(),
  );
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

      return loadPromise.then(
        (loadedUrl) => {
          pendingLoadsRef.current.delete(resourcePath);
          return loadedUrl;
        },
        (error) => {
          pendingLoadsRef.current.delete(resourcePath);
          throw error;
        },
      );
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
  const [loadedSrc, setLoadedSrc] = useState<{
    resourcePath: string;
    src: string;
  } | null>(null);

  if (resourcePath && !deferredStore) {
    throw new Error(
      "Deferred EPUB images must be rendered within DeferredEpubImageProvider.",
    );
  }

  const cachedSrc =
    resourcePath && deferredStore ? deferredStore.getUrl(resourcePath) : null;
  const resolvedSrc = resourcePath
    ? (cachedSrc ??
      (loadedSrc?.resourcePath === resourcePath ? loadedSrc.src : null))
    : src;

  useEffect(() => {
    let cancelled = false;

    if (!resourcePath || !deferredStore || cachedSrc) {
      return () => {
        cancelled = true;
      };
    }

    void deferredStore.loadUrl(resourcePath).then((loadedUrl) => {
      if (cancelled || !loadedUrl) {
        return;
      }

      setLoadedSrc({ resourcePath, src: loadedUrl });
    });

    return () => {
      cancelled = true;
    };
  }, [cachedSrc, deferredStore, resourcePath]);

  return {
    isLoading: !!resourcePath && !resolvedSrc,
    resolvedSrc,
  };
}
