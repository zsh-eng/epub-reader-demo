import type { PageSlice } from "@/lib/pagination-v2";
import { cn } from "@/lib/utils";
import { Fragment } from "react";
import { LazyImage } from "./shared/LazyImage";

interface PageSliceViewProps {
  slice: PageSlice;
  sliceIndex: number;
  bookId: string;
  deferredImageCache: Map<string, string>;
  baseFontSize: number;
}

export function PageSliceView({
  slice,
  sliceIndex,
  bookId,
  deferredImageCache,
  baseFontSize,
}: PageSliceViewProps) {
  const key = `${slice.blockId}-${sliceIndex}`;

  if (slice.type === "spacer") {
    return <div style={{ height: `${slice.height}px` }} />;
  }

  if (slice.type === "image") {
    return (
      <div className="flex justify-center">
        <LazyImage
          bookId={bookId}
          src={slice.src}
          alt={slice.alt || "Chapter image"}
          cache={deferredImageCache}
          width={slice.width}
          height={slice.height}
          style={{ objectFit: "contain" }}
        />
      </div>
    );
  }

  return (
    <p
      className="m-0"
      style={{
        lineHeight: `${slice.lineHeight}px`,
        textAlign: slice.textAlign,
        fontSize: baseFontSize,
      }}
    >
      {slice.lines.map((line, lineIndex) => (
        <Fragment key={`${key}-line-${lineIndex}`}>
          {line.fragments.map((fragment, fragmentIndex) => (
            <span
              key={`${key}-line-${lineIndex}-frag-${fragmentIndex}`}
              style={{
                marginLeft:
                  fragment.leadingGap > 0
                    ? `${fragment.leadingGap}px`
                    : undefined,
                font: fragment.font,
                lineHeight: "inherit",
              }}
              className={cn({
                underline: fragment.isLink,
                "font-medium": fragment.isCode,
              })}
            >
              {fragment.highlightMarks && fragment.highlightMarks.length > 0 ? (
                fragment.highlightMarks.reduceRight<React.ReactNode>(
                  (content, mark) => (
                    <mark
                      className="epub-highlight"
                      data-highlight-id={mark.id}
                      data-color={mark.color}
                    >
                      {content}
                    </mark>
                  ),
                  fragment.text,
                )
              ) : (
                fragment.text
              )}
            </span>
          ))}
        </Fragment>
      ))}
    </p>
  );
}
