import {
  endReaderTraceSpan,
  markReaderTrace,
  startReaderTraceSpan,
} from "@/lib/reader-performance-trace";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useDeferredEpubImage } from "./DeferredEpubImageProvider";

interface LazyImageProps {
  src: string;
  alt?: string;
  width: number;
  height: number;
  style?: CSSProperties;
}

export function LazyImage({ src, alt, width, height, style }: LazyImageProps) {
  const { isLoading, resourcePath, resolvedSrc } = useDeferredEpubImage(src);
  const [decodedImage, setDecodedImage] = useState<{
    src: string;
    status: "ready" | "failed";
  } | null>(null);
  const committedSrcRef = useRef<string | null>(null);

  useEffect(() => {
    if (!resolvedSrc || decodedImage?.src === resolvedSrc) return;

    let cancelled = false;
    const decodeSpan = startReaderTraceSpan("epub-image-decode", "assets", {
      resourcePath: resourcePath ?? src,
      expectedWidth: width,
      expectedHeight: height,
    });
    const image = new Image();
    image.src = resolvedSrc;

    void image.decode().then(
      () => {
        endReaderTraceSpan(decodeSpan, {
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          cancelled,
        });
        if (!cancelled) setDecodedImage({ src: resolvedSrc, status: "ready" });
      },
      (error: unknown) => {
        endReaderTraceSpan(
          decodeSpan,
          {
            error: error instanceof Error ? error.message : String(error),
            cancelled,
          },
          "error",
        );
        if (!cancelled) {
          setDecodedImage({ src: resolvedSrc, status: "failed" });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [decodedImage?.src, height, resolvedSrc, resourcePath, src, width]);

  const imageReady =
    !!resolvedSrc &&
    decodedImage?.src === resolvedSrc &&
    decodedImage.status === "ready";
  const imageSettled =
    !isLoading &&
    (!resolvedSrc ||
      (decodedImage?.src === resolvedSrc && decodedImage.status !== undefined));

  useLayoutEffect(() => {
    if (!imageReady || committedSrcRef.current === decodedImage.src) return;
    committedSrcRef.current = decodedImage.src;
    markReaderTrace("epub-image-dom-committed", "reveal", {
      resourcePath: resourcePath ?? src,
      width,
      height,
    });
  }, [decodedImage, height, imageReady, resourcePath, src, width]);

  if (!imageReady) {
    return (
      <div
        aria-hidden="true"
        data-reader-image-pending={imageSettled ? undefined : "true"}
        data-reader-image-placeholder="true"
        className="bg-accent"
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
      src={decodedImage.src}
      alt={alt || "Chapter image"}
      data-reader-image-ready="true"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        ...style,
      }}
    />
  );
}
