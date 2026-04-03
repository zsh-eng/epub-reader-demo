import { Skeleton } from "@/components/ui/skeleton";
import { getBookFile } from "@/lib/db";
import { getDeferredEpubImagePath } from "@/lib/epub-resource-utils";
import { useEffect, useState, type CSSProperties } from "react";

interface LazyImageProps {
  bookId: string;
  src: string;
  alt?: string;
  width: number;
  height: number;
  cache: Map<string, string>;
  style?: CSSProperties;
}

// Prevent duplicate loads when the same image appears in multiple mounted slices.
const pendingLoads = new Map<string, Promise<Blob | null>>();

async function loadDeferredImage(
  bookId: string,
  resourcePath: string,
): Promise<Blob | null> {
  const pendingKey = `${bookId}:${resourcePath}`;
  const pending = pendingLoads.get(pendingKey);
  if (pending) {
    return pending;
  }

  const loadPromise = (async () => {
    const resourceFile = await getBookFile(bookId, resourcePath);
    if (!resourceFile) {
      console.warn("[LazyImage] Deferred image not found:", resourcePath);
      return null;
    }

    return resourceFile.content;
  })();

  pendingLoads.set(pendingKey, loadPromise);
  try {
    return await loadPromise;
  } finally {
    pendingLoads.delete(pendingKey);
  }
}

export function LazyImage({
  bookId,
  src,
  alt,
  width,
  height,
  cache,
  style,
}: LazyImageProps) {
  const resourcePath = getDeferredEpubImagePath(src);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() => {
    if (!resourcePath) {
      return src;
    }

    return cache.get(resourcePath) ?? null;
  });

  useEffect(() => {
    let cancelled = false;

    if (!resourcePath) {
      setResolvedSrc(src);
      return () => {
        cancelled = true;
      };
    }

    const cachedUrl = cache.get(resourcePath);
    if (cachedUrl) {
      setResolvedSrc(cachedUrl);
      return () => {
        cancelled = true;
      };
    }

    setResolvedSrc(null);

    const load = async () => {
      const imageBlob = await loadDeferredImage(bookId, resourcePath);
      if (cancelled || !imageBlob) {
        return;
      }

      const existingUrl = cache.get(resourcePath);
      if (existingUrl) {
        setResolvedSrc(existingUrl);
        return;
      }

      const loadedUrl = URL.createObjectURL(imageBlob);
      cache.set(resourcePath, loadedUrl);
      if (!cancelled) {
        setResolvedSrc(loadedUrl);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [bookId, cache, resourcePath, src]);

  if (!resolvedSrc) {
    return (
      <Skeleton
        aria-hidden="true"
        className="rounded-none"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          ...style,
        }}
      />
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt || "Chapter image"}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        ...style,
      }}
    />
  );
}
