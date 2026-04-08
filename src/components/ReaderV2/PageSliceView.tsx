import type { PageSlice } from "@/lib/pagination-v2";
import { cn } from "@/lib/utils";
import { Fragment } from "react";
import { LazyImage } from "./shared/LazyImage";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

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
      <div className="flex h-full w-full items-center justify-center">
        <LazyImage
          bookId={bookId}
          src={slice.src}
          alt={slice.alt || "Chapter image"}
          cache={deferredImageCache}
          width={slice.width}
          height={slice.height}
          style={{
            objectFit: "contain",
            borderRadius: "1.25rem",
            outline: "1px solid var(--border)",
            background: "var(--secondary)",
          }}
        />
      </div>
    );
  }

  const textAlign =
    HEADING_TAGS.has(slice.tag) && slice.textAlign === "justify"
      ? "left"
      : slice.textAlign;

  return (
    <p
      className={cn("m-0 box-border text-foreground", {
        "reader-v2-blockquote": slice.tag === "blockquote",
        "reader-v2-figcaption": slice.tag === "figcaption",
      })}
      style={{
        lineHeight: `${slice.lineHeight}px`,
        textAlign,
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
                "reader-v2-inline-link": fragment.isLink,
                "reader-v2-inline-code": fragment.isCode,
              })}
            >
              {fragment.highlightMarks && fragment.highlightMarks.length > 0
                ? fragment.highlightMarks.reduceRight<React.ReactNode>(
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
                : fragment.text}
            </span>
          ))}
        </Fragment>
      ))}
    </p>
  );
}
