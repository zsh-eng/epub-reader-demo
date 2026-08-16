import { useEffect, useState, type CSSProperties } from "react";
import { useDeferredEpubImage } from "./DeferredEpubImageProvider";

interface LazyImageProps {
  src: string;
  alt?: string;
  width: number;
  height: number;
  style?: CSSProperties;
}

export function LazyImage({ src, alt, width, height, style }: LazyImageProps) {
  const { isLoading, resolvedSrc } = useDeferredEpubImage(src);
  const [decodedImage, setDecodedImage] = useState<{
    src: string;
    status: "ready" | "failed";
  } | null>(null);

  useEffect(() => {
    if (!resolvedSrc || decodedImage?.src === resolvedSrc) return;

    let cancelled = false;
    const image = new Image();
    image.src = resolvedSrc;

    void image.decode().then(
      () => {
        if (!cancelled) setDecodedImage({ src: resolvedSrc, status: "ready" });
      },
      () => {
        if (!cancelled) {
          setDecodedImage({ src: resolvedSrc, status: "failed" });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [decodedImage?.src, resolvedSrc]);

  const imageReady =
    !!resolvedSrc &&
    decodedImage?.src === resolvedSrc &&
    decodedImage.status === "ready";
  const imageSettled =
    !isLoading &&
    (!resolvedSrc ||
      (decodedImage?.src === resolvedSrc && decodedImage.status !== undefined));

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
