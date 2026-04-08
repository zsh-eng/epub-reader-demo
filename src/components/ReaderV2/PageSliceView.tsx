import type { PageFragment, PageSlice } from "@/lib/pagination-v2";
import { cn } from "@/lib/utils";
import { toCssTextAlign } from "@/types/reader.types";
import type { ReactNode } from "react";
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

function renderFragmentContent(fragment: PageFragment) {
  if (!fragment.highlightMarks || fragment.highlightMarks.length === 0) {
    return fragment.text;
  }

  return fragment.highlightMarks.reduceRight<ReactNode>(
    (content: ReactNode, mark: NonNullable<PageFragment["highlightMarks"]>[number]) => (
      <mark
        className="epub-highlight"
        data-highlight-id={mark.id}
        data-color={mark.color}
      >
        {content}
      </mark>
    ),
    fragment.text,
  );
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
          }}
        />
      </div>
    );
  }

  const textAlign =
    slice.renderMode === "manual-justify"
      ? "left"
      : HEADING_TAGS.has(slice.tag) &&
        (slice.textAlign === "justify" ||
          slice.textAlign === "justify-knuth-plass")
      ? "left"
      : toCssTextAlign(slice.textAlign);

  return (
    <p
      className={cn("m-0 box-border text-foreground", {
        "reader-v2-blockquote": slice.tag === "blockquote",
        "reader-v2-figcaption": slice.tag === "figcaption",
      })}
      style={{
        lineHeight: `${slice.lineHeight}px`,
        textAlign,
        fontSize: Math.round(baseFontSize),
      }}
    >
      {slice.renderMode === "manual-justify"
        ? slice.lines.map((line, lineIndex) => {
            const trailingBoundaryFragment =
              line.fragments[line.fragments.length - 1]?.kind === "space"
                ? line.fragments[line.fragments.length - 1]
                : null;
            const contentFragments = trailingBoundaryFragment
              ? line.fragments.slice(0, -1)
              : line.fragments;

            return (
              <Fragment key={`${key}-line-${lineIndex}`}>
                <span
                  style={{
                    whiteSpace: "nowrap",
                    wordSpacing:
                      line.wordSpacingPx !== undefined &&
                      Math.abs(line.wordSpacingPx) > 0.01
                        ? `${line.wordSpacingPx}px`
                        : undefined,
                  }}
                >
                  {contentFragments.map((fragment, fragmentIndex) => (
                    <span
                      key={`${key}-line-${lineIndex}-frag-${fragmentIndex}`}
                      style={{
                        font: fragment.font,
                        lineHeight: "inherit",
                        marginRight:
                          fragment.marginRightPx !== undefined &&
                          Math.abs(fragment.marginRightPx) > 0.01
                            ? `${fragment.marginRightPx}px`
                            : undefined,
                      }}
                      className={cn({
                        "reader-v2-inline-link": fragment.isLink,
                        "reader-v2-inline-code": fragment.isCode,
                      })}
                    >
                      {renderFragmentContent(fragment)}
                    </span>
                  ))}
                </span>
                {trailingBoundaryFragment ? (
                  <span
                    style={{
                      font: trailingBoundaryFragment.font,
                      lineHeight: "inherit",
                    }}
                  >
                    {renderFragmentContent(trailingBoundaryFragment)}
                  </span>
                ) : null}
              </Fragment>
            );
          })
        : slice.lines.map((line, lineIndex) => (
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
                  {renderFragmentContent(fragment)}
                </span>
              ))}
            </Fragment>
          ))}
    </p>
  );
}
