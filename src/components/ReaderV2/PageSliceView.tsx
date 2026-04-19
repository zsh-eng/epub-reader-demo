import type { PageFragment, PageSlice } from "@/lib/pagination-v2";
import {
    CONTENT_ANCHOR_BLOCK_ID_ATTR,
    CONTENT_ANCHOR_END_ATTR,
    CONTENT_ANCHOR_START_ATTR,
    serializeTextCursorOffset,
} from "@/lib/pagination-v2/content-anchor-dom";
import { cn } from "@/lib/utils";
import { toCssTextAlign } from "@/types/reader.types";
import type { CSSProperties, ReactNode } from "react";
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

function getFragmentAnchorData(fragment: PageFragment) {
  return {
    ...(fragment.anchorStart
      ? {
          [CONTENT_ANCHOR_START_ATTR]: serializeTextCursorOffset(
            fragment.anchorStart,
          ),
        }
      : {}),
    ...(fragment.anchorEnd
      ? {
          [CONTENT_ANCHOR_END_ATTR]: serializeTextCursorOffset(fragment.anchorEnd),
        }
      : {}),
  };
}

function renderInlineFragment(
  fragment: PageFragment,
  key: string,
  style: CSSProperties,
) {
  const className = cn({
    "reader-v2-inline-link": Boolean(fragment.link),
    "reader-v2-inline-code": fragment.isCode,
  });
  const content = renderFragmentContent(fragment);
  const anchorData = getFragmentAnchorData(fragment);

  if (fragment.link) {
    return (
      <a
        key={key}
        href={fragment.link.href}
        style={style}
        className={className}
        {...anchorData}
      >
        {content}
      </a>
    );
  }

  return (
    <span key={key} style={style} className={className} {...anchorData}>
      {content}
    </span>
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
      <div
        className="flex w-full items-center justify-center"
        style={{ height: `${slice.height}px` }}
      >
        <LazyImage
          bookId={bookId}
          src={slice.src}
          alt={slice.alt || "Chapter image"}
          cache={deferredImageCache}
          width={slice.width}
          height={slice.height}
          style={{
            objectFit: "contain",
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
      {...{ [CONTENT_ANCHOR_BLOCK_ID_ATTR]: slice.blockId }}
      // There is a difference between the line height CSS property and the actual line height
      // that is rendered out.
      // For instance, with "Iowan Old Style" font on 17px, the rendered height of the box is
      // always 0.5px taller than the line height. E.g. 25px line height renders at 25.5px,
      // 24px line height renders at 24.5px, 28px line height renders at 28.5px, and so on.
      // Thus we need to set the `height` property to match the number of lines and line height
      // such that we don't get overflow in these cases.
      style={{
        lineHeight: `${slice.lineHeight}px`,
        height: `${slice.lines.length * slice.lineHeight}px`,
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
                    renderInlineFragment(
                      fragment,
                      `${key}-line-${lineIndex}-frag-${fragmentIndex}`,
                      {
                        font: fragment.font,
                        lineHeight: "inherit",
                        marginRight:
                          fragment.marginRightPx !== undefined &&
                          Math.abs(fragment.marginRightPx) > 0.01
                            ? `${fragment.marginRightPx}px`
                            : undefined,
                      },
                    )
                  ))}
                </span>
                {trailingBoundaryFragment ? (
                  renderInlineFragment(
                    trailingBoundaryFragment,
                    `${key}-line-${lineIndex}-trailing`,
                    {
                      font: trailingBoundaryFragment.font,
                      lineHeight: "inherit",
                    },
                  )
                ) : null}
              </Fragment>
            );
          })
        : slice.lines.map((line, lineIndex) => (
            <Fragment key={`${key}-line-${lineIndex}`}>
              {line.fragments.map((fragment, fragmentIndex) => (
                renderInlineFragment(
                  fragment,
                  `${key}-line-${lineIndex}-frag-${fragmentIndex}`,
                  {
                    marginLeft:
                      fragment.leadingGap > 0
                        ? `${fragment.leadingGap}px`
                        : undefined,
                    font: fragment.font,
                    lineHeight: "inherit",
                  },
                )
              ))}
            </Fragment>
          ))}
    </p>
  );
}
