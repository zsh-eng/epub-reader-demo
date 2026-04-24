import { Skeleton } from "@/components/ui/skeleton";
import type { CSSProperties } from "react";
import { useDeferredEpubImage } from "./DeferredEpubImageProvider";

interface LazyImageProps {
  src: string;
  alt?: string;
  width: number;
  height: number;
  style?: CSSProperties;
}

export function LazyImage({ src, alt, width, height, style }: LazyImageProps) {
  const { resolvedSrc } = useDeferredEpubImage(src);

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
